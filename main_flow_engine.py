import MetaTrader5 as mt5
import pandas as pd
import threading
import queue
import time
import sys
import logging
from datetime import datetime, timedelta, timezone
from collections import deque
from fluxo_atemporal_modulo import (
    construir_grafico_range, detectar_reversoes_fluxo,
    verificar_microestrutura_spread, enviar_ordem_com_protecao_b3,
    RenkoFlowEngine, MT5PyramidOrderManager, extrair_dados_tick
)
from config import (
    ATIVO_ALVO, TAMANHO_RANGE_PTS, LOTES_TESTE, MAGIC_NUMBER,
    MAX_BUFFER_TICKS, FILA_MAXSIZE, TICK_POLL_INTERVAL,
    PONTOS_SL, PONTOS_TP, MT5_PATH, MODO_ESTRATEGIA,
    RENKO_BOX_PTS, CONTRATOS_MAE, CONTRATOS_PIRAMIDE
)

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

fila_ticks = queue.Queue(maxsize=FILA_MAXSIZE)
lock_buffer = threading.Lock()

def validar_ambiente_simulado():
    """Garante que o script nunca rode acidentalmente em Conta Real"""
    try:
        if not mt5.initialize(path=MT5_PATH):
            logger.error("Erro ao conectar ao terminal MT5.")
            sys.exit(1)
        account_info = mt5.account_info()
        if account_info is None or account_info.trade_mode not in [mt5.ACCOUNT_TRADE_MODE_DEMO, mt5.ACCOUNT_TRADE_MODE_CONTEST]:
            logger.critical("ALERTA CRÍTICO: BLOQUEADO EXECUÇÃO EM CONTA REAL!")
            mt5.shutdown()
            sys.exit(1)
        logger.info(f"AMBIENTE SEGURO: Rodando em modo SIMULADOR ({account_info.server})")
    except Exception as e:
        logger.error(f"Erro na validação do ambiente: {e}")
        mt5.shutdown()
        sys.exit(1)

def pipeline_captura_dados(ativo):
    """Thread 1: Captura os ticks brutos da B3 continuamente"""
    last_tick_time = 0
    try:
        if not mt5.market_book_add(ativo):
            logger.warning(f"Não foi possível assinar Level 2 para {ativo}. Continuando sem book completo.")
        while True:
            try:
                ref = mt5.symbol_info_tick(ativo)
                if ref is None:
                    time.sleep(0.5)
                    continue
                desde_ms = last_tick_time if last_tick_time else (ref.time_msc - 1000)
                inicio = datetime.fromtimestamp(desde_ms / 1000.0, tz=timezone.utc)
                ticks = mt5.copy_ticks_from(ativo, inicio, 1000, mt5.COPY_TICKS_ALL)
                if ticks is not None and len(ticks) > 0:
                    for tick in ticks:
                        if tick['time_msc'] > last_tick_time:
                            try:
                                fila_ticks.put(tick, timeout=0.1)
                                last_tick_time = tick['time_msc']
                            except queue.Full:
                                logger.warning("Fila de ticks cheia. Descartando ticks mais antigos.")
                time.sleep(TICK_POLL_INTERVAL)
            except Exception as e:
                logger.error(f"Erro na captura de ticks: {e}")
                time.sleep(1)
    except Exception as e:
        logger.error(f"Erro fatal na pipeline de captura: {e}")

def pipeline_processamento_puro(ativo, tamanho_range):
    """Thread 2: Processa cálculos matemáticos e dispara as ordens"""
    logger.info(f"Motor de processamento ativo para {ativo} (Modo: {MODO_ESTRATEGIA})...")
    
    if MODO_ESTRATEGIA == "RENKO_PIRAMIDE_CONFLUENCIA":
        engine = RenkoFlowEngine(box_points=RENKO_BOX_PTS)
        order_mgr = MT5PyramidOrderManager(symbol=ativo, contracts_mae=CONTRATOS_MAE, contracts_piramide=CONTRATOS_PIRAMIDE, magic_number=MAGIC_NUMBER)
        
        while True:
            try:
                tick = fila_ticks.get(timeout=1)
                p_last, vol, aggressor, ts = extrair_dados_tick(tick)
                if p_last <= 0:
                    continue

                new_box, signal, reason = engine.process_tick(p_last, vol, aggressor, ts)
                if new_box:
                    logger.info(f"[RENKO 10R] Box #{new_box['index']} {new_box['direction']} fechado @ {new_box['close']:.1f} | Delta: {new_box['delta']:+.0f} | CVD: {engine.cvd:+.0f}")
                
                if signal and new_box:
                    logger.info(f"⚡ [GATILHO RENKO CONFLUÊNCIA]: {signal} ({reason})")
                    success, ticket, role = order_mgr.execute_pyramid_confluence(signal, new_box)
                    if success:
                        logger.info(f"✅ ORDEM EXECUTADA [{role}]: {signal} Ticket #{ticket}")
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Erro no processamento Renko: {e}")
    else:
        buffer_ticks = deque(maxlen=MAX_BUFFER_TICKS)
        while True:
            try:
                tick = fila_ticks.get(timeout=1)
                buffer_ticks.append(tick)
                
                if len(buffer_ticks) % 10 == 0:
                    df_ticks = pd.DataFrame(list(buffer_ticks)).rename(
                        columns={'last': 'price', 'volume': 'volume', 'bid': 'bid', 'ask': 'ask'}
                    )
                    try:
                        footprint, ohlc = construir_grafico_range(df_ticks, tamanho_range_pts=tamanho_range, point_size=1.0)
                        sinais = detectar_reversoes_fluxo(footprint, ohlc)
                        
                        if not sinais.empty:
                            ultimo_sinal = sinais.iloc[-1]
                            tipo_sinal_str = ultimo_sinal['tipo_sinal']
                            direcao = 'COMPRA' if 'COMPRA' in tipo_sinal_str else 'VENDA'
                            logger.info(f"[GATILHO DETECTADO]: {tipo_sinal_str} em {ultimo_sinal['preco_gatilho']}")
                            
                            if verificar_microestrutura_spread(ativo, direcao_sinal=direcao):
                                res = enviar_ordem_com_protecao_b3(ativo, direcao, lotes=LOTES_TESTE, pontos_sl=PONTOS_SL, pontos_tp=PONTOS_TP, magic_number=MAGIC_NUMBER)
                                if res and hasattr(res, 'retcode') and res.retcode == mt5.TRADE_RETCODE_DONE:
                                    logger.info("Ordem enviada com sucesso!")
                                else:
                                    err = mt5.last_error()
                                    logger.error(f"Falha ao enviar ordem: {res.retcode if res else 'None'} - {err}")
                            else:
                                logger.warning(f"Microestrutura não apoia sinal {direcao}. Ordem não enviada.")
                    except Exception as e:
                        logger.error(f"Erro no processamento de sinal: {e}")
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Erro inesperado no processamento: {e}")


if __name__ == "__main__":
    validar_ambiente_simulado()
    
    t1 = threading.Thread(target=pipeline_captura_dados, args=(ATIVO_ALVO,), daemon=True)
    t2 = threading.Thread(target=pipeline_processamento_puro, args=(ATIVO_ALVO, TAMANHO_RANGE_PTS), daemon=True)
    
    t1.start()
    t2.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Desconectando sistema de trading quantitativo.")
        mt5.shutdown()
