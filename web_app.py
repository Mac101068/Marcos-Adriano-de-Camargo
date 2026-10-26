import os
import sys
import json
import threading
import time
import queue
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional
import logging

import MetaTrader5 as mt5
import pandas as pd

from fluxo_atemporal_modulo import (
    construir_grafico_range,
    detectar_reversoes_fluxo,
    verificar_microestrutura_spread,
    enviar_ordem_com_protecao_b3,
    RenkoFlowEngine,
    MT5PyramidOrderManager,
    extrair_dados_tick,
)
from config import (
    ATIVO_ALVO,
    TAMANHO_RANGE_PTS,
    LOTES_TESTE,
    MAGIC_NUMBER,
    MAX_BUFFER_TICKS,
    FILA_MAXSIZE,
    TICK_POLL_INTERVAL,
    PONTOS_SL,
    PONTOS_TP,
    MT5_PATH,
    MODO_ESTRATEGIA,
    RENKO_BOX_PTS,
    MIN_DELTA_THRESHOLD,
    CONTRATOS_MAE,
    CONTRATOS_PIRAMIDE,
    PYRAMID_TP_PTS,
    MAX_POSICOES_PIRAMIDE,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("robofluxo_web")

class RoboFluxoState:
    def __init__(self):
        self.running = False
        self.thread_capture = None
        self.thread_process = None
        self.fila_ticks = queue.Queue(maxsize=FILA_MAXSIZE)
        self.last_signals = []
        self.logs = []
        self.mt5_connected = False
        self.account_info = None
        self.error = None
        self.last_tick_time = 0
        self.orders_count = 0
        self.signals_count = 0
        self.chart_ohlc = []
        self.chart_footprint = {}
        self._chart_lock = threading.Lock()
        
        # Estratégia Renko & Pirâmide de Confluência (10R, 15R, 20R, etc.)
        self.strategy_mode = MODO_ESTRATEGIA
        self.renko_r = 10
        self.renko_box_pts = RENKO_BOX_PTS
        self.renko_engine = RenkoFlowEngine(box_points=self.renko_box_pts)
        self.pyramid_manager = None
        self.renko_boxes = []
        self.current_cvd = 0.0
        self.sim_resultado = None

        # Simulação
        self.simulation_mode = False
        self.simulation_speed = 10  # multiplicador de velocidade
        self.simulation_progress = 0  # 0 a 100
        self.simulation_total_ticks = 0
        self.simulation_processed_ticks = 0
        self.simulation_date = None
        self.simulation_current_tick_time = "--:--:--"
        self.thread_simulation = None


    def log(self, msg: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {msg}"
        self.logs.append(log_entry)
        if len(self.logs) > 200:
            self.logs = self.logs[-200:]
        logger.info(msg)

state = RoboFluxoState()

def is_mt5_process_running() -> bool:
    try:
        import subprocess
        res = subprocess.run(["tasklist", "/fi", "imagename eq terminal64.exe", "/fo", "csv"], capture_output=True, text=True)
        return "terminal64.exe" in res.stdout.lower()
    except Exception:
        return True

def validar_e_conectar():
    try:
        if not is_mt5_process_running():
            state.mt5_connected = False
            state.account_info = None
            state.error = "MetaTrader 5 não está aberto. Abra o MetaTrader 5 pela sua Área de Trabalho primeiro e clique em Conectar."
            return False

        state.mt5_connected = False
        state.account_info = None

        if not mt5.initialize():
            state.error = "MetaTrader 5 não está respondendo. Verifique se há uma conta logada."
            return False

        account_info = mt5.account_info()
        if account_info is None:
            state.error = "Não foi possível obter informações da conta. Verifique se há uma conta logada no MT5."
            try:
                mt5.shutdown()
            except Exception:
                pass
            return False

        if account_info.trade_mode not in [mt5.ACCOUNT_TRADE_MODE_DEMO, mt5.ACCOUNT_TRADE_MODE_CONTEST]:
            state.error = "BLOQUEADO: Conta Real detectada. Utilize apenas conta DEMO ou CONTEST."
            try:
                mt5.shutdown()
            except Exception:
                pass
            state.mt5_connected = False
            state.account_info = None
            return False

        state.mt5_connected = True
        state.account_info = {
            "login": account_info.login,
            "server": account_info.server,
            "balance": float(account_info.balance),
            "equity": float(account_info.equity),
            "trade_mode": int(account_info.trade_mode),
        }
        state.error = None
        state.log(f"Conectado ao MT5 - Login: {account_info.login} | Server: {account_info.server}")
        return True
    except Exception as e:
        state.mt5_connected = False
        state.account_info = None
        state.error = str(e)
        try:
            mt5.shutdown()
        except Exception:
            pass
        return False

def pipeline_captura_dados(ativo):
    state.last_tick_time = 0
    try:
        if not mt5.market_book_add(ativo):
            state.log(f"Aviso: Não foi possível assinar Level 2 para {ativo}")
        while state.running:
            try:
                ref = mt5.symbol_info_tick(ativo)
                if ref is None:
                    time.sleep(0.1)
                    continue
                
                server_time_sec = int(ref.time)
                ticks = mt5.copy_ticks_from(ativo, server_time_sec - 3, 500, mt5.COPY_TICKS_ALL)
                if ticks is not None and len(ticks) > 0:
                    for tick in ticks:
                        tick_msc = int(tick['time_msc'])
                        if tick_msc > state.last_tick_time:
                            try:
                                state.fila_ticks.put(tick, timeout=0.1)
                                state.last_tick_time = tick_msc
                            except queue.Full:
                                pass
                time.sleep(TICK_POLL_INTERVAL)
            except Exception as e:
                state.log(f"Erro na captura: {e}")
                time.sleep(0.5)
    except Exception as e:
        state.log(f"Erro fatal na captura: {e}")

def pipeline_processamento_puro(ativo, tamanho_range):
    from collections import deque
    buffer_ticks = deque(maxlen=MAX_BUFFER_TICKS)
    state.log(f"Processamento iniciado para {ativo} (Modo: {state.strategy_mode})")
    
    while state.running:
        try:
            tick = state.fila_ticks.get(timeout=1)
            buffer_ticks.append(tick)
            
            # ─────────────────────────────────────────────────────────────
            # MODO 1: RENKO 10R & PIRÂMIDE DE CONFLUÊNCIA (GitHub Marcos-Adriano-de-Camargo)
            # ─────────────────────────────────────────────────────────────
            if state.strategy_mode == "RENKO_PIRAMIDE_CONFLUENCIA":
                p_last, vol, aggressor, ts = extrair_dados_tick(tick)
                if p_last <= 0:
                    continue

                new_box, signal, reason = state.renko_engine.process_tick(p_last, vol, aggressor, ts)
                state.current_cvd = state.renko_engine.cvd

                if new_box:
                    with state._chart_lock:
                        state.renko_boxes.append(new_box)
                        if len(state.renko_boxes) > 200:
                            state.renko_boxes = state.renko_boxes[-200:]
                        
                        ohlc_bar = {
                            'bar_id': int(new_box['index']),
                            'open': float(new_box['open']),
                            'high': float(new_box['high']),
                            'low': float(new_box['low']),
                            'close': float(new_box['close']),
                            'volume': float(new_box['buy_volume'] + new_box['sell_volume']),
                            'delta': float(new_box['delta']),
                            'direction': new_box['direction']
                        }
                        state.chart_ohlc.append(ohlc_bar)
                        if len(state.chart_ohlc) > 200:
                            state.chart_ohlc = state.chart_ohlc[-200:]

                    state.log(f"[RENKO 10R] Box #{new_box['index']} {new_box['direction']} fechou em {new_box['close']:.1f} | Delta: {new_box['delta']:+.0f} | CVD: {state.current_cvd:+.0f}")

                if signal and new_box:
                    state.signals_count += 1
                    signal_info = {
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "tipo": f"RENKO_{signal}_{new_box['direction']}",
                        "preco": float(new_box['close']),
                        "direcao": signal
                    }
                    state.last_signals.append(signal_info)
                    if len(state.last_signals) > 50:
                        state.last_signals = state.last_signals[-50:]
                    state.log(f"⚡ GATILHO RENKO CONFLUÊNCIA: {signal} ({reason})")

                    if state.pyramid_manager:
                        success, ticket, role = state.pyramid_manager.execute_pyramid_confluence(signal, new_box)
                        if success:
                            state.orders_count += 1
                            state.log(f"✅ ORDEM EXECUTADA [{role}]: {signal} Ticket #{ticket}")

            # ─────────────────────────────────────────────────────────────
            # MODO 2: RANGE FOOTPRINT TRADICIONAL
            # ─────────────────────────────────────────────────────────────
            else:
                if len(buffer_ticks) % 10 == 0:
                    df_ticks = pd.DataFrame(list(buffer_ticks)).rename(
                        columns={'last': 'price', 'volume': 'volume', 'bid': 'bid', 'ask': 'ask'}
                    )
                    try:
                        footprint, ohlc = construir_grafico_range(df_ticks, tamanho_range_pts=tamanho_range, point_size=1.0)

                        with state._chart_lock:
                            ohlc_list = []
                            for bar_id, row in ohlc.iterrows():
                                ohlc_list.append({
                                    'bar_id': int(bar_id),
                                    'open': float(row['open']),
                                    'high': float(row['high']),
                                    'low': float(row['low']),
                                    'close': float(row['close']),
                                    'volume': float(row['total_volume']),
                                })
                            state.chart_ohlc = ohlc_list[-200:]

                            fp_dict = {}
                            for _, fp_row in footprint.iterrows():
                                bid = int(fp_row['bar_id'])
                                if bid not in fp_dict:
                                    fp_dict[bid] = []
                                fp_dict[bid].append({
                                    'price': float(fp_row['price']),
                                    'buy_vol': float(fp_row['buy_vol']),
                                    'sell_vol': float(fp_row['sell_vol']),
                                    'delta': float(fp_row['delta']),
                                })
                            valid_ids = set(b['bar_id'] for b in state.chart_ohlc)
                            state.chart_footprint = {k: v for k, v in fp_dict.items() if k in valid_ids}

                        sinais = detectar_reversoes_fluxo(footprint, ohlc)
                        
                        if not sinais.empty:
                            ultimo_sinal = sinais.iloc[-1]
                            tipo_sinal_str = ultimo_sinal['tipo_sinal']
                            direcao = 'COMPRA' if 'COMPRA' in tipo_sinal_str else 'VENDA'
                            state.signals_count += 1
                            signal_info = {
                                "time": datetime.now().strftime("%H:%M:%S"),
                                "tipo": tipo_sinal_str,
                                "preco": float(ultimo_sinal['preco_gatilho']),
                                "direcao": direcao
                            }
                            state.last_signals.append(signal_info)
                            if len(state.last_signals) > 50:
                                state.last_signals = state.last_signals[-50:]
                            state.log(f"GATILHO: {tipo_sinal_str} em {ultimo_sinal['preco_gatilho']}")
                            
                            if verificar_microestrutura_spread(ativo, direcao_sinal=direcao):
                                res = enviar_ordem_com_protecao_b3(ativo, direcao, lotes=LOTES_TESTE, pontos_sl=PONTOS_SL, pontos_tp=PONTOS_TP, magic_number=MAGIC_NUMBER)
                                if res and hasattr(res, 'retcode') and res.retcode == mt5.TRADE_RETCODE_DONE:
                                    state.orders_count += 1
                                    state.log(f"ORDEM ENVIADA: {direcao} {LOTES_TESTE} lotes")
                                else:
                                    err = mt5.last_error()
                                    state.log(f"Falha ao enviar ordem: {err}")
                            else:
                                state.log(f"Microestrutura não apoia {direcao}")
                    except Exception as e:
                        state.log(f"Erro no processamento: {e}")
        except queue.Empty:
            continue
        except Exception as e:
            state.log(f"Erro inesperado: {e}")

def start_robot(ativo: str = ATIVO_ALVO, renko_r: int = None, box_points: int = None):
    if state.running:
        stop_robot()
        time.sleep(0.3)
    if not state.mt5_connected:
        if not validar_e_conectar():
            return False, state.error
    try:
        if box_points is not None:
            state.renko_box_pts = int(box_points)
            state.renko_r = max(1, state.renko_box_pts // 5)
        elif renko_r is not None:
            state.renko_r = int(renko_r)
            state.renko_box_pts = state.renko_r * 5

        state.running = False
        time.sleep(0.2)
        state.running = True
        state.fila_ticks = queue.Queue(maxsize=FILA_MAXSIZE)
        state.last_signals = []
        state.signals_count = 0
        state.orders_count = 0
        
        # Inicializa o motor de Renko (10R, 15R, 20R...)
        state.renko_engine = RenkoFlowEngine(box_points=state.renko_box_pts)
        # Modo Monitoramento / Leitura Pura: Não envia ordens pelo web_app para não conflitar com o robô oficial
        state.pyramid_manager = None
        state.renko_boxes = []
        state.current_cvd = 0.0

        state.thread_capture = threading.Thread(target=pipeline_captura_dados, args=(ativo,), daemon=True)
        state.thread_process = threading.Thread(target=pipeline_processamento_puro, args=(ativo, TAMANHO_RANGE_PTS), daemon=True)
        state.thread_capture.start()
        state.thread_process.start()
        state.log(f"Robô iniciado - Ativo: {ativo} | Renko: {state.renko_r}R ({state.renko_box_pts} pts) | Modo: {state.strategy_mode}")
        return True, f"Robô iniciado com sucesso ({state.renko_r}R - {state.renko_box_pts} pts)"
    except Exception as e:
        state.running = False
        state.log(f"Erro ao iniciar: {e}")
        return False, str(e)


def stop_robot():
    if not state.running:
        return False, "Robô já está parado"
    try:
        state.running = False
        state.simulation_mode = False
        time.sleep(0.5)
        state.log("Robô parado")
        return True, "Robô parado com sucesso"
    except Exception as e:
        state.running = False
        state.simulation_mode = False
        state.log(f"Robô parado com aviso: {e}")
        return True, "Robô parado com sucesso"


# ═══════════════════════════════════════════════════════════════
# MODO SIMULAÇÃO — Replay de Ticks Históricos (MT5 e CSV)
# ═══════════════════════════════════════════════════════════════

def buscar_ticks_historicos(ativo: str, data_str: str = None, num_ticks: int = 25000, posicao: str = "inicio"):
    """
    Busca ticks históricos do MT5. Se data_str for None, busca do último pregão com dados.
    posicao: 'inicio' (primeiros ticks a partir das 09:00), 'fim' (últimos ticks até as 18:00), 'tudo'.
    """
    if not state.mt5_connected:
        if not validar_e_conectar():
            return None, state.error or "Não conectado ao MT5"

    try:
        if data_str:
            data_base = datetime.strptime(data_str, "%Y-%m-%d")
        else:
            # Buscar último dia útil
            data_base = datetime.now()
            while data_base.weekday() >= 5:  # 5=sábado, 6=domingo
                data_base -= timedelta(days=1)

        # Pregão B3 (09:00 às 18:30 Brasília = 12:00 às 21:30 UTC)
        data_inicio = data_base.replace(hour=12, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        data_fim = data_base.replace(hour=21, minute=30, second=0, microsecond=0, tzinfo=timezone.utc)

        state.log(f"Buscando ticks de {ativo} em {data_base.strftime('%d/%m/%Y')} (09:00-18:30 Brasília)...")

        ticks = mt5.copy_ticks_range(ativo, data_inicio, data_fim, mt5.COPY_TICKS_ALL)

        if ticks is None or len(ticks) == 0:
            # Tentar dias anteriores (até 10 dias úteis atrás)
            for dias_atras in range(1, 12):
                data_tentativa = data_base - timedelta(days=dias_atras)
                if data_tentativa.weekday() >= 5:
                    continue
                data_inicio = data_tentativa.replace(hour=12, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
                data_fim = data_tentativa.replace(hour=21, minute=30, second=0, microsecond=0, tzinfo=timezone.utc)
                state.log(f"Tentando {data_tentativa.strftime('%d/%m/%Y')}...")
                ticks = mt5.copy_ticks_range(ativo, data_inicio, data_fim, mt5.COPY_TICKS_ALL)
                if ticks is not None and len(ticks) > 0:
                    data_base = data_tentativa
                    break


        if ticks is None or len(ticks) == 0:
            return None, f"Nenhum tick histórico encontrado para {ativo} no MT5."

        df = pd.DataFrame(ticks)

        # Filtrar ticks sem negócio (last == 0 ou NaN)
        if 'last' in df.columns:
            df = df[df['last'] > 0]

        total_disponivel = len(df)
        if total_disponivel == 0:
            return None, f"Nenhum negócio válido encontrado para {ativo} nesta data."

        # Aplicar corte conforme posicao
        if num_ticks and total_disponivel > num_ticks:
            if posicao == "fim":
                df = df.tail(num_ticks).copy()
            else:  # "inicio" por padrão
                df = df.head(num_ticks).copy()

        info_data = data_base.strftime('%d/%m/%Y')
        state.log(f"Encontrados {len(df):,} ticks de {info_data} (total no pregão: {total_disponivel:,})")
        return df, info_data

    except Exception as e:
        state.log(f"Erro ao buscar ticks históricos: {e}")
        return None, str(e)


def carregar_ticks_csv_bytes(file_bytes: bytes) -> Optional[pd.DataFrame]:
    """
    Carrega ticks de arquivo CSV exportado do MetaTrader 5 ou similar.
    Suporta separadores tabulação, vírgula ou ponto-e-vírgula.
    """
    import io
    try:
        text = file_bytes.decode('utf-8', errors='ignore')
        if not text.strip():
            return None

        first_line = text.split('\n')[0]
        sep = '\t' if '\t' in first_line else (';' if ';' in first_line else ',')

        df = pd.read_csv(io.StringIO(text), sep=sep)
        df.columns = [c.strip().lower().replace('<', '').replace('>', '') for c in df.columns]

        # Normalizar colunas comuns
        if 'last' not in df.columns and 'price' in df.columns:
            df['last'] = df['price']
        if 'volume' not in df.columns and 'vol' in df.columns:
            df['volume'] = df['vol']
        if 'volume_real' in df.columns and 'volume' not in df.columns:
            df['volume'] = df['volume_real']

        # Garantir colunas mínimas
        if 'last' not in df.columns:
            return None

        # Filtrar valores válidos
        df = df[pd.to_numeric(df['last'], errors='coerce') > 0].copy()
        return df
    except Exception as e:
        state.log(f"Erro ao analisar CSV: {e}")
        return None


def pipeline_simulacao(ativo: str, ticks_df: pd.DataFrame, tamanho_range: int, velocidade: int):
    """
    Pipeline de simulação: reproduz ticks históricos simulando a dinâmica de fluxo real.
    Gera Range Bars, Footprint, sinais e ordens simuladas.
    """
    from collections import deque
    buffer_ticks = deque(maxlen=MAX_BUFFER_TICKS)

    total = len(ticks_df)
    state.simulation_total_ticks = total
    state.simulation_processed_ticks = 0
    state.simulation_progress = 0
    state.log(f"[SIM] Simulação iniciada: {total:,} ticks | Velocidade: {velocidade}x")

    ticks_records = ticks_df.to_dict('records')

    # Configuração de velocidade de replay
    if velocidade <= 1:
        batch_size = 5
        sleep_interval = 0.04  # ~125 ticks/s
    elif velocidade <= 5:
        batch_size = 20
        sleep_interval = 0.03  # ~660 ticks/s
    elif velocidade <= 10:
        batch_size = 40
        sleep_interval = 0.02  # ~2.000 ticks/s
    elif velocidade <= 25:
        batch_size = 100
        sleep_interval = 0.015  # ~6.600 ticks/s
    elif velocidade <= 50:
        batch_size = 200
        sleep_interval = 0.01  # ~20.000 ticks/s
    else:  # Modo Turbo / Máxima
        batch_size = 500
        sleep_interval = 0.001

    last_detected_signal_key = None
    i = 0

    modo_renko = (state.strategy_mode == "RENKO_PIRAMIDE_CONFLUENCIA")
    bt = None
    if modo_renko:
        from backtest_renko import BacktestPiramide
        bt = BacktestPiramide(min_delta=MIN_DELTA_THRESHOLD)
        state.renko_engine = bt.engine
        state.renko_boxes = []
        state.current_cvd = 0.0
        state.sim_resultado = bt.resumo()
        with state._chart_lock:
            state.chart_ohlc = []
            state.chart_footprint = {}
    ultimo_preco, ultima_hora = 0.0, "12:00:00"

    while i < total and state.running and state.simulation_mode:
        try:
            end_idx = min(i + batch_size, total)

            for j in range(i, end_idx):
                tick = ticks_records[j]
                last_price = float(tick.get('last') or tick.get('price') or 0.0)
                if last_price <= 0:
                    continue

                vol = float(tick.get('volume') or tick.get('volume_real') or 1.0)
                bid = float(tick.get('bid') or 0.0)
                ask = float(tick.get('ask') or 0.0)
                t_msc = int(tick.get('time_msc') or 0)
                t_sec = int(tick.get('time') or 0)

                tick_compat = {
                    'price': last_price,
                    'volume': vol,
                    'bid': bid,
                    'ask': ask,
                    'time_msc': t_msc,
                    'time': t_sec,
                }
                buffer_ticks.append(tick_compat)

                if modo_renko:
                    p, v, agg, ts = extrair_dados_tick(tick)
                    hora = datetime.utcfromtimestamp(t_sec).strftime("%H:%M:%S") if t_sec > 0 else "12:00:00"
                    ultimo_preco, ultima_hora = p, hora
                    n_boxes = len(bt.engine.boxes)
                    sinais_antes = bt.sinais
                    eventos = bt.on_tick(p, v, 1 if agg == "BUY" else (-1 if agg == "SELL" else 0), hora)
                    state.current_cvd = bt.engine.cvd
                    if len(bt.engine.boxes) > n_boxes:
                        new_box = bt.engine.boxes[-1]
                        with state._chart_lock:
                            state.renko_boxes.append(new_box)
                            state.renko_boxes = state.renko_boxes[-200:]
                            state.chart_ohlc.append({
                                'bar_id': int(new_box['index']),
                                'open': float(new_box['open']),
                                'high': float(new_box['high']),
                                'low': float(new_box['low']),
                                'close': float(new_box['close']),
                                'volume': float(new_box['buy_volume'] + new_box['sell_volume']),
                                'delta': float(new_box['delta']),
                                'direction': new_box['direction'],
                            })
                            state.chart_ohlc = state.chart_ohlc[-200:]
                        if bt.sinais > sinais_antes:
                            sig = "BUY" if new_box['direction'] == "UP" else "SELL"
                            state.signals_count += 1
                            state.last_signals.append({
                                "time": hora,
                                "tipo": f"RENKO_{sig}",
                                "preco": float(new_box['close']),
                                "direcao": sig,
                            })
                            state.last_signals = state.last_signals[-50:]
                    for ev in eventos:
                        if "MÃE" in ev or "PIRÂMIDE" in ev:
                            state.orders_count += 1
                        state.log(f"[SIM] {hora} {ev}")
                    if eventos:
                        state.sim_resultado = bt.resumo()

            state.simulation_processed_ticks = end_idx
            state.simulation_progress = int((end_idx / total) * 100)

            # Atualizar relógio simulado com o horário do tick atual
            if buffer_ticks:
                last_t = buffer_ticks[-1].get('time', 0)
                if last_t > 0:
                    try:
                        state.simulation_current_tick_time = datetime.utcfromtimestamp(last_t).strftime("%H:%M:%S")
                    except Exception:
                        pass

            # Atualizar gráficos e processar sinais a cada batch ou no final
            is_final = (end_idx >= total)
            if not modo_renko and len(buffer_ticks) >= 10 and (end_idx % max(20, batch_size) == 0 or is_final):
                df_ticks = pd.DataFrame(list(buffer_ticks))

                try:
                    footprint, ohlc = construir_grafico_range(
                        df_ticks, tamanho_range_pts=tamanho_range, point_size=1.0
                    )

                    with state._chart_lock:
                        ohlc_list = []
                        for bar_id, row in ohlc.iterrows():
                            ohlc_list.append({
                                'bar_id': int(bar_id),
                                'open': float(row['open']),
                                'high': float(row['high']),
                                'low': float(row['low']),
                                'close': float(row['close']),
                                'volume': float(row['total_volume']),
                            })
                        state.chart_ohlc = ohlc_list[-200:]

                        fp_dict = {}
                        for _, fp_row in footprint.iterrows():
                            bid = int(fp_row['bar_id'])
                            if bid not in fp_dict:
                                fp_dict[bid] = []
                            fp_dict[bid].append({
                                'price': float(fp_row['price']),
                                'buy_vol': float(fp_row['buy_vol']),
                                'sell_vol': float(fp_row['sell_vol']),
                                'delta': float(fp_row['delta']),
                            })
                        valid_ids = set(b['bar_id'] for b in state.chart_ohlc)
                        state.chart_footprint = {k: v for k, v in fp_dict.items() if k in valid_ids}

                    sinais = detectar_reversoes_fluxo(footprint, ohlc)

                    if not sinais.empty:
                        ultimo_sinal = sinais.iloc[-1]
                        tipo_sinal_str = ultimo_sinal['tipo_sinal']
                        sinal_bar_id = int(ultimo_sinal.get('bar_id', -1))
                        signal_key = (sinal_bar_id, tipo_sinal_str)

                        # Evitar duplicar o mesmo sinal para a mesma barra
                        if signal_key != last_detected_signal_key:
                            last_detected_signal_key = signal_key
                            direcao = 'COMPRA' if 'COMPRA' in tipo_sinal_str else 'VENDA'
                            state.signals_count += 1
                            state.orders_count += 1

                            sinal_hora = state.simulation_current_tick_time if state.simulation_current_tick_time != "--:--:--" else datetime.now().strftime("%H:%M:%S")
                            signal_info = {
                                "time": sinal_hora,
                                "tipo": tipo_sinal_str,
                                "preco": float(ultimo_sinal['preco_gatilho']),
                                "direcao": direcao
                            }
                            state.last_signals.append(signal_info)
                            if len(state.last_signals) > 50:
                                state.last_signals = state.last_signals[-50:]
                            state.log(f"[SIM] GATILHO {direcao} (#{sinal_bar_id}): {tipo_sinal_str} em {ultimo_sinal['preco_gatilho']} | Ordem simulada")

                except Exception as e:
                    state.log(f"[SIM] Erro no cálculo: {e}")

            i = end_idx

            if sleep_interval > 0:
                time.sleep(sleep_interval)

        except Exception as e:
            state.log(f"[SIM] Erro inesperado: {e}")
            i += 1

    state.simulation_progress = 100
    if bt is not None and ultimo_preco > 0:
        bt.finalizar(ultimo_preco, ultima_hora)
        state.sim_resultado = bt.resumo()
        r = state.sim_resultado
        state.log(f"[SIM] RESULTADO: {r['operacoes']} operações | {r['pts']:+.0f} pts | R$ {r['reais']:+.2f} | acerto {r.get('acerto', 0):.1f}% | pior DD {r.get('max_dd_pts', 0):.0f} pts")
    state.running = False
    state.simulation_mode = False
    state.log(f"[SIM] Simulação finalizada: {state.signals_count} sinais | {state.orders_count} ordens simuladas executadas.")


def start_simulation_from_df(ticks_df: pd.DataFrame, ativo: str = ATIVO_ALVO, velocidade: int = 10, nome_fonte: str = "Histórico"):
    """Inicia simulação a partir de um DataFrame de ticks já preparado."""
    if state.running:
        stop_robot()
        time.sleep(0.3)

    try:
        state.running = True
        state.simulation_mode = True
        state.simulation_speed = velocidade
        state.simulation_date = nome_fonte
        state.simulation_progress = 0
        state.simulation_processed_ticks = 0
        state.simulation_current_tick_time = "--:--:--"
        state.fila_ticks = queue.Queue(maxsize=FILA_MAXSIZE)
        state.last_signals = []
        state.signals_count = 0
        state.orders_count = 0

        with state._chart_lock:
            state.chart_ohlc = []
            state.chart_footprint = {}

        state.thread_simulation = threading.Thread(
            target=pipeline_simulacao,
            args=(ativo, ticks_df, TAMANHO_RANGE_PTS, velocidade),
            daemon=True
        )
        state.thread_simulation.start()

        msg = f"Simulação iniciada: {len(ticks_df):,} ticks de [{nome_fonte}] | Velocidade {velocidade}x"
        state.log(msg)
        return True, msg

    except Exception as e:
        state.running = False
        state.simulation_mode = False
        state.log(f"Erro ao iniciar simulação: {e}")
        return False, str(e)


def start_simulation(ativo: str = ATIVO_ALVO, velocidade: int = 10, data: str = None, num_ticks: int = 25000, posicao: str = "inicio"):
    """Inicia o modo simulação buscando ticks históricos do MT5."""
    if state.running:
        stop_robot()
        time.sleep(0.3)
    if not state.mt5_connected:
        if not validar_e_conectar():
            return False, state.error or "Não foi possível conectar ao MT5"

    if data == "3dias":
        dfs = []
        for d_str in ["2026-10-21", "2026-10-22", "2026-10-23"]:
            d_df, _ = buscar_ticks_historicos(ativo, d_str, num_ticks=num_ticks if (num_ticks and num_ticks < 500000) else None, posicao=posicao)
            if d_df is not None and not d_df.empty:
                dfs.append(d_df)
        if not dfs:
            return False, "Nenhum tick encontrado para a sequência de 3 dias."
        ticks_df = pd.concat(dfs, ignore_index=True)
        return start_simulation_from_df(ticks_df, ativo=ativo, velocidade=velocidade, nome_fonte=f"{ativo} - Sequência 3 Dias (21 a 23/10)")

    ticks_df, info = buscar_ticks_historicos(ativo, data, num_ticks=num_ticks, posicao=posicao)
    if ticks_df is None:
        return False, info

    return start_simulation_from_df(ticks_df, ativo=ativo, velocidade=velocidade, nome_fonte=f"{ativo} - {info}")



def get_chart_data():
    """Retorna dados de gráfico (OHLC range bars + footprint + renko 10R) para o frontend."""
    with state._chart_lock:
        return {
            "ohlc": list(state.chart_ohlc),
            "footprint": {str(k): v for k, v in state.chart_footprint.items()},
            "renko_boxes": list(state.renko_boxes),
            "cvd": float(state.current_cvd),
            "strategy_mode": state.strategy_mode,
        }


def get_status():
    return {
        "running": state.running,
        "mt5_connected": state.mt5_connected,
        "account_info": state.account_info,
        "error": state.error,
        "strategy_mode": state.strategy_mode,
        "cvd": float(state.current_cvd),
        "renko_r": getattr(state, "renko_r", 10),
        "renko_box_pts": getattr(state, "renko_box_pts", RENKO_BOX_PTS),
        "min_delta": MIN_DELTA_THRESHOLD,
        "sim_resultado": state.sim_resultado,
        "signals_count": state.signals_count,
        "orders_count": state.orders_count,
        "queue_size": state.fila_ticks.qsize(),
        "last_signals": state.last_signals[-10:],
        "logs": state.logs[-50:],
        "simulation_mode": state.simulation_mode,
        "simulation_speed": state.simulation_speed,
        "simulation_progress": state.simulation_progress,
        "simulation_total_ticks": state.simulation_total_ticks,
        "simulation_processed_ticks": state.simulation_processed_ticks,
        "simulation_date": state.simulation_date,
        "simulation_current_tick_time": state.simulation_current_tick_time,
    }


