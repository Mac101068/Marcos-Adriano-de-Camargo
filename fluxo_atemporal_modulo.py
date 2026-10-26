import MetaTrader5 as mt5
import pandas as pd
import numpy as np
from typing import Tuple, Optional, Dict, Any, List
from datetime import datetime
import time
import logging
from config import (
    DESEQUILIBRIO_MINIMO_BOOK, THRESHOLD_ABSORCAO, THRESHOLD_EXAUSTAO,
    RENKO_BOX_PTS, MIN_DELTA_THRESHOLD, CONTRATOS_MAE, CONTRATOS_PIRAMIDE,
    PYRAMID_TP_PTS, MAX_POSICOES_PIRAMIDE, HORA_INICIO_TRADING,
    HORA_FIM_ENTRADAS, HORA_ZERAGEM_OBRIGATORIA
)

logger = logging.getLogger(__name__)



def normalizar_preco_b3(ativo: str, preco_bruto: float) -> float:
    """
    Arredonda o preço bruto para o passo de tick exato exigido pela B3 
    (5 pontos para WIN e 0.5 pontos para WDO), evitando rejeições.
    """
    try:
        symbol_info = mt5.symbol_info(ativo)
        if symbol_info is None:
            return float(preco_bruto)
            
        tick_size = symbol_info.trade_tick_size
        if tick_size is None or tick_size <= 0:
            return float(preco_bruto)
        
        preco_normalizado = round(float(preco_bruto) / float(tick_size)) * float(tick_size)
        return round(preco_normalizado, int(symbol_info.digits))
    except Exception:
        return float(preco_bruto)


def construir_grafico_range(ticks_df: pd.DataFrame, tamanho_range_pts: float, point_size: float = 1.0) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Transforma ticks em range bars e calcula footprint por preço."""
    if ticks_df is None or ticks_df.empty:
        return pd.DataFrame(columns=['bar_id', 'price', 'buy_vol', 'sell_vol', 'delta']), pd.DataFrame(columns=['open', 'high', 'low', 'close', 'total_volume'])
    
    if tamanho_range_pts <= 0:
        raise ValueError('tamanho_range_pts deve ser maior que zero.')
    if point_size <= 0:
        raise ValueError('point_size deve ser maior que zero.')

    try:
        precos = ticks_df['price'].to_numpy(dtype=float)
        volumes = ticks_df['volume'].to_numpy(dtype=float)
        asks = ticks_df['ask'].to_numpy(dtype=float)
    except (KeyError, TypeError) as e:
        raise ValueError(f"Dados de tick inválidos: {e}")

    is_buy = precos >= asks
    buy_vol = np.where(is_buy, volumes, 0.0)
    sell_vol = np.where(~is_buy, volumes, 0.0)

    bar_ids = np.zeros(len(ticks_df), dtype=int)
    current_bar_id = 0
    bar_high = precos[0]
    bar_low = precos[0]
    tamanho_maximo = float(tamanho_range_pts) * float(point_size)

    for i in range(len(precos)):
        p = precos[i]
        temp_high = max(bar_high, p)
        temp_low = min(bar_low, p)

        if (temp_high - temp_low) > tamanho_maximo:
            current_bar_id += 1
            bar_high = p
            bar_low = p
        else:
            bar_high = temp_high
            bar_low = temp_low
        bar_ids[i] = current_bar_id

    ticks_df_work = ticks_df.copy()
    ticks_df_work['bar_id'] = bar_ids
    ticks_df_work['buy_vol'] = buy_vol
    ticks_df_work['sell_vol'] = sell_vol

    footprint = ticks_df_work.groupby(['bar_id', 'price'], as_index=False).agg({'buy_vol': 'sum', 'sell_vol': 'sum'})
    footprint['delta'] = footprint['buy_vol'] - footprint['sell_vol']

    ohlc = ticks_df_work.groupby('bar_id').agg(
        open=('price', 'first'),
        high=('price', 'max'),
        low=('price', 'min'),
        close=('price', 'last'),
        total_volume=('volume', 'sum')
    )
    return footprint, ohlc


def detectar_reversoes_fluxo(footprint_df: pd.DataFrame, ohlc_df: pd.DataFrame, threshold_absorcao: float = THRESHOLD_ABSORCAO, threshold_exaustao: float = THRESHOLD_EXAUSTAO) -> pd.DataFrame:
    """Analisa as extremidades das barras para encontrar sinais de reversão."""
    if footprint_df is None or ohlc_df is None or ohlc_df.empty:
        return pd.DataFrame(columns=['bar_id', 'tipo_sinal', 'preco_gatilho'])
    
    if threshold_absorcao <= 0 or threshold_exaustao < 0:
        raise ValueError('Thresholds inválidos.')

    sinais_reversao = []
    for bar_id, barra in ohlc_df.iterrows():
        try:
            niveis_barra = footprint_df[footprint_df['bar_id'] == bar_id].sort_values(by='price')
            if niveis_barra.empty or len(niveis_barra) < 2:
                continue

            volume_total = float(niveis_barra['buy_vol'].sum() + niveis_barra['sell_vol'].sum())
            vol_medio_barra = volume_total / max(len(niveis_barra), 1)

            if 'high' in barra and 'low' in barra:
                topo_match = niveis_barra[niveis_barra['price'] == barra['high']]
                fundo_match = niveis_barra[niveis_barra['price'] == barra['low']]
                if topo_match.empty or fundo_match.empty:
                    continue

                fluxo_topo = topo_match.iloc[0]
                fluxo_fundo = fundo_match.iloc[0]
                tipo_vela = 'ALTA' if barra['close'] >= barra['open'] else 'BAIXA'

                if fluxo_topo['buy_vol'] > (vol_medio_barra * threshold_absorcao) and tipo_vela == 'BAIXA':
                    sinais_reversao.append({'bar_id': bar_id, 'tipo_sinal': 'REVERSAO_VENDA_ABSORCAO', 'preco_gatilho': barra['high']})
                elif fluxo_topo['buy_vol'] < (vol_medio_barra * threshold_exaustao) and tipo_vela == 'BAIXA':
                    sinais_reversao.append({'bar_id': bar_id, 'tipo_sinal': 'REVERSAO_VENDA_EXAUSTAO', 'preco_gatilho': barra['high']})

                if fluxo_fundo['sell_vol'] > (vol_medio_barra * threshold_absorcao) and tipo_vela == 'ALTA':
                    sinais_reversao.append({'bar_id': bar_id, 'tipo_sinal': 'REVERSAO_COMPRA_ABSORCAO', 'preco_gatilho': barra['low']})
                elif fluxo_fundo['sell_vol'] < (vol_medio_barra * threshold_exaustao) and tipo_vela == 'ALTA':
                    sinais_reversao.append({'bar_id': bar_id, 'tipo_sinal': 'REVERSAO_COMPRA_EXAUSTAO', 'preco_gatilho': barra['low']})
        except Exception:
            continue

    return pd.DataFrame(sinais_reversao)


def verificar_microestrutura_spread(ativo: str, direcao_sinal: str, desequilibrio_minimo_book: float = DESEQUILIBRIO_MINIMO_BOOK) -> bool:
    """Valida se o livro de ofertas apoia o sinal gerado."""
    try:
        book = mt5.market_book_get(ativo)
        if book is None or len(book) == 0:
            return False

        df_book = pd.DataFrame(book)
        bids = df_book[df_book['type'] == mt5.BOOK_TYPE_BUY]
        asks = df_book[df_book['type'] == mt5.BOOK_TYPE_SELL]
        if bids.empty or asks.empty:
            return False

        liquidez_compra = bids.sort_values(by='price', ascending=False).head(5)['volume'].sum()
        liquidez_venda = asks.sort_values(by='price', ascending=True).head(5)['volume'].sum()

        if liquidez_venda <= 0 or liquidez_compra <= 0:
            return False

        if direcao_sinal == 'COMPRA':
            return (liquidez_compra / liquidez_venda) >= desequilibrio_minimo_book
        if direcao_sinal == 'VENDA':
            return (liquidez_venda / liquidez_compra) >= desequilibrio_minimo_book
        return False
    except Exception:
        return False


def enviar_ordem_com_protecao_b3(ativo: str, tipo_sinal: str, lotes: float, pontos_sl: int, pontos_tp: int, magic_number: int):
    """Envia ordem assíncrona automática com SL e TP normalizados para a B3."""
    try:
        tick_info = mt5.symbol_info_tick(ativo)
        symbol_info = mt5.symbol_info(ativo)
        if tick_info is None or symbol_info is None:
            return False

        point_size = getattr(symbol_info, 'point', 0)
        if point_size is None or point_size <= 0:
            return False

        if tipo_sinal == 'COMPRA':
            tipo_ordem = mt5.ORDER_TYPE_BUY
            preco_entrada = tick_info.ask
            preco_sl = normalizar_preco_b3(ativo, preco_entrada - (pontos_sl * point_size))
            preco_tp = normalizar_preco_b3(ativo, preco_entrada + (pontos_tp * point_size))
        elif tipo_sinal == 'VENDA':
            tipo_ordem = mt5.ORDER_TYPE_SELL
            preco_entrada = tick_info.bid
            preco_sl = normalizar_preco_b3(ativo, preco_entrada + (pontos_sl * point_size))
            preco_tp = normalizar_preco_b3(ativo, preco_entrada - (pontos_tp * point_size))
        else:
            return False

        preco_entrada_norm = normalizar_preco_b3(ativo, preco_entrada)

        request = {
            'action': mt5.TRADE_ACTION_DEAL,
            'symbol': ativo,
            'volume': float(lotes),
            'type': tipo_ordem,
            'price': float(preco_entrada_norm),
            'sl': float(preco_sl),
            'tp': float(preco_tp),
            'deviation': 10,
            'magic': magic_number,
            'comment': 'Python Flow Engine',
            'type_time': mt5.ORDER_TIME_GTC,
            'type_filling': mt5.ORDER_FILLING_IOC,
        }
        return mt5.order_send_async(request)
    except Exception:
        return False


TICK_FLAG_BUY_MT5 = 32
TICK_FLAG_SELL_MT5 = 64


def extrair_dados_tick(tick) -> Tuple[float, float, Optional[str], float]:
    """
    Lê um tick vindo do MT5 (numpy.void) ou de simulação/CSV (dict).
    Retorna (preco, volume, agressor, timestamp_msc).
    Agressor: usa flags do MT5 (BUY=32, SELL=64); senão, compara last com bid/ask.
    """
    def campo(nome, padrao=0.0):
        try:
            if isinstance(tick, dict):
                v = tick.get(nome, padrao)
            else:
                v = tick[nome] if nome in tick.dtype.names else padrao
            return padrao if v is None or (isinstance(v, float) and np.isnan(v)) else v
        except Exception:
            return padrao

    preco = float(campo('last', 0.0) or campo('price', 0.0) or 0.0)
    volume = float(campo('volume_real', 0.0) or campo('volume', 0.0) or 1.0)
    bid = float(campo('bid', 0.0) or 0.0)
    ask = float(campo('ask', 0.0) or 0.0)
    flags = int(campo('flags', 0) or 0)
    ts = float(campo('time_msc', 0) or 0)

    agressor = None
    if flags & TICK_FLAG_BUY_MT5 and not flags & TICK_FLAG_SELL_MT5:
        agressor = "BUY"
    elif flags & TICK_FLAG_SELL_MT5 and not flags & TICK_FLAG_BUY_MT5:
        agressor = "SELL"
    elif ask > 0 and preco >= ask:
        agressor = "BUY"
    elif bid > 0 and preco <= bid:
        agressor = "SELL"

    return preco, volume, agressor, ts


def get_filling_mode_b3(ativo: str) -> int:
    """Detecta modo de preenchimento suportado pela corretora na B3."""
    sym_info = mt5.symbol_info(ativo)
    if sym_info is None:
        return mt5.ORDER_FILLING_RETURN
    fill = sym_info.filling_mode
    # bit 1 (2) = IOC, bit 0 (1) = FOK, bit 2 (4) = RETURN
    if fill & 2:
        return mt5.ORDER_FILLING_IOC
    elif fill & 1:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


class RenkoFlowEngine:
    """
    Motor de Gráficos Atemporais Renko (10R / 50 pontos B3):
    - Constrói tijolos Renko atemporais
    - Acumula Delta e CVD tick-a-tick
    - Detecta confluência de rompimento de box com agressão de fluxo
    """
    def __init__(self, box_points: int = RENKO_BOX_PTS, min_delta: float = MIN_DELTA_THRESHOLD):
        self.box_points = box_points
        self.min_delta = float(min_delta)
        self.boxes: List[Dict[str, Any]] = []
        self.current_box: Optional[Dict[str, Any]] = None
        self.cvd: float = 0.0

    def init_engine(self, initial_price: float, timestamp: Any = None):
        base_price = round(initial_price / 5.0) * 5.0
        self.current_box = {
            "index": 0,
            "direction": "UP",
            "open": base_price,
            "close": base_price,
            "high": base_price,
            "low": base_price,
            "time_start": timestamp or datetime.now(),
            "ticks_count": 0,
            "buy_volume": 0.0,
            "sell_volume": 0.0,
            "delta": 0.0,
            "cvd_at_close": 0.0,
            "price_levels": {}
        }

    def process_tick(self, price: float, volume: float, aggressor: str, timestamp: Any = None):
        """
        Recebe cada tick em tempo real.
        aggressor: 'BUY', 'SELL' ou None.
        Retorna (new_box, signal, reason)
        """
        tick_delta = volume if aggressor == "BUY" else (-volume if aggressor == "SELL" else 0.0)
        self.cvd += tick_delta

        if self.current_box is None:
            self.init_engine(price, timestamp)

        curr = self.current_box
        curr["ticks_count"] += 1
        if "price_levels" not in curr:
            curr["price_levels"] = {}

        p_level = round(price / 5.0) * 5.0
        if p_level not in curr["price_levels"]:
            curr["price_levels"][p_level] = {"buy_vol": 0.0, "sell_vol": 0.0}

        if aggressor == "BUY":
            curr["buy_volume"] += volume
            curr["price_levels"][p_level]["buy_vol"] += volume
        elif aggressor == "SELL":
            curr["sell_volume"] += volume
            curr["price_levels"][p_level]["sell_vol"] += volume
        else:
            curr["price_levels"][p_level]["buy_vol"] += volume / 2.0
            curr["price_levels"][p_level]["sell_vol"] += volume / 2.0

        curr["delta"] = curr["buy_volume"] - curr["sell_volume"]
        curr["high"] = max(curr["high"], price)
        curr["low"] = min(curr["low"], price)
        curr["close"] = price

        new_box = None
        signal = None
        reason = ""

        last_dir = self.boxes[-1]["direction"] if len(self.boxes) > 0 else "UP"
        last_close = self.boxes[-1]["close"] if len(self.boxes) > 0 else curr["open"]

        if last_dir == "UP":
            if price >= last_close + self.box_points:
                new_box = self._create_closed_box("UP", last_close, last_close + self.box_points, curr, timestamp)
            elif price <= last_close - (self.box_points * 2):
                prev_open = self.boxes[-1]["open"] if len(self.boxes) > 0 else (last_close - self.box_points)
                new_box = self._create_closed_box("DOWN", prev_open, prev_open - self.box_points, curr, timestamp)
        else:
            if price <= last_close - self.box_points:
                new_box = self._create_closed_box("DOWN", last_close, last_close - self.box_points, curr, timestamp)
            elif price >= last_close + (self.box_points * 2):
                prev_open = self.boxes[-1]["open"] if len(self.boxes) > 0 else (last_close + self.box_points)
                new_box = self._create_closed_box("UP", prev_open, prev_open + self.box_points, curr, timestamp)

        if new_box:
            self.boxes.append(new_box)
            signal, reason = self.check_convergence(new_box, self.min_delta)

            # Novo tijolo iniciado
            self.current_box = {
                "index": len(self.boxes),
                "direction": new_box["direction"],
                "open": new_box["close"],
                "close": price,
                "high": price,
                "low": price,
                "time_start": timestamp or datetime.now(),
                "ticks_count": 0,
                "buy_volume": 0.0,
                "sell_volume": 0.0,
                "delta": 0.0,
                "cvd_at_close": self.cvd,
                "price_levels": {}
            }

        return new_box, signal, reason

    def _create_closed_box(self, direction: str, box_open: float, box_close: float, curr: Dict[str, Any], timestamp: Any):
        return {
            "index": len(self.boxes),
            "direction": direction,
            "open": box_open,
            "close": box_close,
            "high": max(curr["high"], box_close if direction == "UP" else box_open),
            "low": min(curr["low"], box_open if direction == "UP" else box_close),
            "ticks_count": curr["ticks_count"],
            "buy_volume": curr["buy_volume"],
            "sell_volume": curr["sell_volume"],
            "delta": curr["delta"],
            "cvd_at_close": self.cvd,
            "timestamp": timestamp or datetime.now().strftime("%H:%M:%S"),
            "price_levels": curr.get("price_levels", {}).copy()
        }

    def check_convergence(self, box: Dict[str, Any], min_delta: float = MIN_DELTA_THRESHOLD) -> Tuple[Optional[str], str]:
        delta = box["delta"]
        direction = box["direction"]

        if direction == "UP" and delta >= min_delta:
            reason = f"Convergência COMPRA: Box 10R Alta + Delta +{delta:.0f} ctrs"
            return "BUY", reason
        elif direction == "DOWN" and delta <= -min_delta:
            reason = f"Convergência VENDA: Box 10R Baixa + Delta {delta:.0f} ctrs"
            return "SELL", reason

        return None, ""


def check_market_accumulation(boxes: List[Dict[str, Any]], box_to_check: Dict[str, Any], window_size: int = 6, max_alternations: int = 3, min_range_mult: float = 2.0, box_points: float = 100.0) -> Tuple[bool, bool, str, float, float]:
    """
    Identifica se o mercado está em região de ACUMULAÇÃO / CONSOLIDAÇÃO / CAIXOTE:
    Retorna: (is_accumulating: bool, is_breakout: bool, reason: str, range_min: float, range_max: float)
    """
    if len(boxes) < window_size:
        return False, False, "", 0.0, 0.0

    recent_boxes = boxes[-window_size:]

    # 1. Contagem de alternâncias consecutivas (Choppiness)
    alternations = 0
    for i in range(1, len(recent_boxes)):
        if recent_boxes[i]["direction"] != recent_boxes[i-1]["direction"]:
            alternations += 1

    # 2. Amplitude dos boxes anteriores ao box atual
    highs = [b["high"] for b in recent_boxes[:-1]]
    lows = [b["low"] for b in recent_boxes[:-1]]
    if not highs or not lows:
        return False, False, "", 0.0, 0.0

    range_max = max(highs)
    range_min = min(lows)
    amplitude = range_max - range_min
    min_required_amplitude = box_points * min_range_mult

    is_choppy = alternations >= max_alternations
    is_narrow = amplitude < min_required_amplitude

    if not is_choppy and not is_narrow:
        return False, False, "", range_min, range_max

    # Se estava consolidado, verifica se o box_to_check rompeu efetivamente o caixote
    curr_close = float(box_to_check["close"])
    direction = box_to_check["direction"]

    if direction == "UP" and curr_close > range_max:
        return False, True, f"Rompimento de Alta do Caixote [{range_min:.0f} - {range_max:.0f}] confirmado no close {curr_close:.0f}", range_min, range_max
    elif direction == "DOWN" and curr_close < range_min:
        return False, True, f"Rompimento de Baixa do Caixote [{range_min:.0f} - {range_max:.0f}] confirmado no close {curr_close:.0f}", range_min, range_max

    reason_detail = []
    if is_choppy:
        reason_detail.append(f"{alternations} viradas em {window_size} boxes (choppiness)")
    if is_narrow:
        reason_detail.append(f"amplitude {amplitude:.0f} pts < mín {min_required_amplitude:.0f} pts")

    reason = f"Acumulação/Caixote [{range_min:.0f} - {range_max:.0f}] ({', '.join(reason_detail)})"
    return True, False, reason, range_min, range_max


class MT5PyramidOrderManager:
    """
    Gerenciador Institucional de Ordens B3:
    1. Ordem Mãe: Aberta no primeiro box na virada do fluxo, sem TP fixo (surfa a tendência).
    2. Pirâmide: Aberta a cada box seguinte na mesma direção, com TP fixo de 50 pontos (+1 box).
    3. Inversão Total: Na virada de fluxo, todas as ordens (mãe + pirâmides) são zeradas a mercado.
    4. Entrada no Pullback / Reteste: Opção de posicionar ordem limit na abertura do box.
    """
    def __init__(self, symbol: str, contracts_mae: float = CONTRATOS_MAE, contracts_piramide: float = CONTRATOS_PIRAMIDE, magic_number: int = 101068):
        self.symbol = symbol
        self.contracts_mae = float(contracts_mae)
        self.contracts_piramide = float(contracts_piramide)
        self.magic_number = magic_number
        self.pending_orders: List[Dict[str, Any]] = []

    def check_schedule(self) -> Tuple[bool, bool]:
        """Retorna (pode_operar, deve_zerar_tudo)"""
        now_hm = datetime.now().strftime("%H:%M")
        if now_hm >= HORA_ZERAGEM_OBRIGATORIA:
            logger.warning(f"[HORÁRIO B3] Zeragem obrigatória ({now_hm} >= {HORA_ZERAGEM_OBRIGATORIA})")
            self.close_all_positions()
            return False, True
        if now_hm < HORA_INICIO_TRADING or now_hm >= HORA_FIM_ENTRADAS:
            logger.info(f"[HORÁRIO B3] Fora da janela de trading ({now_hm} fora de {HORA_INICIO_TRADING}-{HORA_FIM_ENTRADAS})")
            return False, False
        return True, False

    def close_all_positions(self) -> int:
        """Zera imediatamente todas as posições abertas para o símbolo e magic_number."""
        try:
            positions = mt5.positions_get(symbol=self.symbol)
            if not positions:
                return 0

            closed_count = 0
            for pos in positions:
                if self.magic_number != 0 and pos.magic != self.magic_number:
                    continue

                close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
                tick = mt5.symbol_info_tick(self.symbol)
                if not tick:
                    continue
                price = tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask

                request = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "position": pos.ticket,
                    "symbol": self.symbol,
                    "volume": float(pos.volume),
                    "type": close_type,
                    "price": float(price),
                    "deviation": 20,
                    "magic": self.magic_number,
                    "comment": "Zeragem Inversao Fluxo",
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": get_filling_mode_b3(self.symbol),
                }
                res = mt5.order_send(request)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    closed_count += 1
                    logger.info(f"[ZERAGEM] Posição #{pos.ticket} fechada com sucesso ({pos.volume} ctrs)")
                else:
                    logger.error(f"[ERRO ZERAGEM] Falha ao fechar #{pos.ticket}: {res.comment if res else 'Erro MT5'}")
            return closed_count
        except Exception as e:
            logger.error(f"Erro em close_all_positions: {e}")
            return 0

    def execute_market_order(self, order_type: str, comment: str = "", volume: float = 1.0, sl_points: float = 0.0, tp_points: float = 0.0) -> Tuple[bool, int]:
        can_trade, _ = self.check_schedule()
        if not can_trade:
            return False, 0

        tick = mt5.symbol_info_tick(self.symbol)
        sym_info = mt5.symbol_info(self.symbol)
        if not tick or not sym_info:
            return False, 0

        point = sym_info.point
        is_buy = (order_type == "BUY")
        entry_price = tick.ask if is_buy else tick.bid

        sl_price = 0.0
        if sl_points > 0:
            sl_raw = (entry_price - sl_points * point) if is_buy else (entry_price + sl_points * point)
            sl_price = normalizar_preco_b3(self.symbol, sl_raw)

        tp_price = 0.0
        if tp_points > 0:
            tp_raw = (entry_price + tp_points * point) if is_buy else (entry_price - tp_points * point)
            tp_price = normalizar_preco_b3(self.symbol, tp_raw)

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": self.symbol,
            "volume": float(volume),
            "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
            "price": float(normalizar_preco_b3(self.symbol, entry_price)),
            "sl": float(sl_price),
            "tp": float(tp_price),
            "deviation": 20,
            "magic": self.magic_number,
            "comment": comment[:31],
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": get_filling_mode_b3(self.symbol),
        }

        res = mt5.order_send(request)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            logger.info(f"✅ ORDEM EXECUTADA: {order_type} {volume} ctrs @ {entry_price:.1f} | SL={sl_price} TP={tp_price} Ticket #{res.order}")
            return True, res.order
        else:
            logger.error(f"[FALHA MT5] RetCode={res.retcode if res else 'None'}, Desc={res.comment if res else ''}")
            return False, 0

    def execute_pyramid_confluence(self, signal: str, box: Dict[str, Any], max_pyramids: int = MAX_POSICOES_PIRAMIDE) -> Tuple[bool, int, str]:
        """
        Executa a lógica de Pirâmide & Confluência:
        1. Inversão: Se o sinal é COMPRA mas temos posições de VENDA (ou vice-versa), zera tudo imediatamente.
        2. Ordem Mãe: Se não há posições abertas na direção, abre a Ordem Mãe (surfe sem TP fixo).
        3. Pirâmide: Se já existe a Ordem Mãe e o limite não foi atingido, abre ordem de pirâmide com TP de 50 pts.
        """
        can_trade, _ = self.check_schedule()
        if not can_trade:
            return False, 0, "BLOCKED_SCHEDULE"

        positions = mt5.positions_get(symbol=self.symbol)
        active_positions = [p for p in (positions or []) if (self.magic_number == 0 or p.magic == self.magic_number)]

        is_signal_buy = (signal == "BUY")
        has_opposite = False

        for pos in active_positions:
            is_pos_buy = (pos.type == mt5.ORDER_TYPE_BUY)
            if is_signal_buy != is_pos_buy:
                has_opposite = True
                break

        if has_opposite:
            logger.info(f"🔄 [INVERSÃO DE FLUXO] Fechando posições contrárias para virar para {signal}!")
            self.close_all_positions()
            time.sleep(0.05)
            active_positions = []

        has_main_order = False
        pyramid_count = 0
        for pos in active_positions:
            if "MAE" in pos.comment:
                has_main_order = True
            elif "PIR" in pos.comment:
                pyramid_count += 1

        if not has_main_order:
            # Abrir Ordem Mãe (Surfe)
            comment = f"MAE_{box['index']}"
            success, ticket = self.execute_market_order(
                order_type=signal,
                comment=comment,
                volume=self.contracts_mae,
                sl_points=0.0,
                tp_points=0.0
            )
            return success, ticket, "MAIN"
        else:
            if pyramid_count >= max_pyramids:
                logger.info(f"[PIRÂMIDE] Limite máximo de {max_pyramids} ordens de pirâmide atingido.")
                return False, 0, "MAX_PYRAMID_REACHED"

            pyramid_num = pyramid_count + 1
            comment = f"PIR_{pyramid_num}_{box['index']}"
            success, ticket = self.execute_market_order(
                order_type=signal,
                comment=comment,
                volume=self.contracts_piramide,
                sl_points=0.0,
                tp_points=float(PYRAMID_TP_PTS)
            )
            return success, ticket, "PYRAMID"

