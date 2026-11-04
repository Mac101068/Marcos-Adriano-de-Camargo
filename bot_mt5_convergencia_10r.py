"""
========================================================================================
ROBÔ QUANTITATIVO MT5: PIRÂMIDE & CONFLUÊNCIA DE FLUXO RENKO 10R (B3 MINI-ÍNDICE)
========================================================================================
Ativo Padrão: WINZ26 (Mini-Índice B3)
Conta Conectada: XPMT5-DEMO (XP Investimentos)
Estratégia: PIRÂMIDE EM CADA BOX VERDE/VERMELHO (TP 50p) + ORDEM MÃE (SURFE ATÉ INVERSÃO)
Ponte WebSocket: ws://localhost:8765

Regras de Execução ao Vivo:
  1. Box Verde Fecha -> COMPRA. Se for o primeiro box, abre ORDEM MÃE (sem TP fixo, surfa a tendência).
  2. Próximos Boxes Verdes -> abre ordens de PIRÂMIDE com TP de +50 pontos cada.
  3. Box Vermelho Fecha -> INVERSÃO TOTAL: encerra imediatamente a ordem mãe e todas as ordens de pirâmide.
     Em seguida, abre a ORDEM MÃE DE VENDA e empilha vendas nos próximos boxes vermelhos.
  4. Stop Loss Dinâmico: Zeragem obrigatória na INVERSÃO DO FLUXO/MERCADO ou horário limite (17:50).
========================================================================================
"""

import sys
import os
import time
import json
import asyncio
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import MetaTrader5 as mt5
import websockets

# ==============================================================================
# CONFIGURAÇÕES DA ESTRATÉGIA E MODO DE OPERAÇÃO
# ==============================================================================
SYMBOL = "WINZ26"
MAGIC_NUMBER = 101010
ORDER_COMMENT = "Renko10R_Flow"

# ==============================================================================
# CONFIGURAÇÃO DE RENKO DINÂMICO (10R, 15R, 20R, etc.)
# ==============================================================================
# No Mini-Índice B3 (WIN): 1R = 5 pontos.
# Exemplos:
#   10R = 50 pontos  (Scalp rápido, mais caixas)
#   15R = 75 pontos  (Tendência média, bom equilíbrio)
#   20R = 100 pontos (Tendência longa, menos ruído)
#   25R = 125 pontos (Filtro anti-ruído)
# ==============================================================================
RENKO_R = 10                     # Valor R do Renko (10, 15, 20, etc.)
BOX_POINTS = RENKO_R * 5         # Calculado automaticamente a partir do R
PYRAMID_TP_POINTS = BOX_POINTS   # Alvo de cada pirâmide (+1 box do Renko selecionado)
PYRAMID_CONTRACTS = 1.0         # Lote das ordens de pirâmide
MAIN_CONTRACTS = 1.0            # Lote da ordem mãe de surfe
MAX_POSITIONS = 5               # Limite máximo de ordens simultâneas
MIN_DELTA_THRESHOLD = 50.0      # Delta mínimo para entrada comum
MIN_DELTA_THRESHOLD = 50.0      # Delta mínimo para entrada comum
MIN_REVERSAL_DELTA = 75.0       # Delta mínimo obrigatório para autorizar reversão de mão (Filtro Anti-Whipsaw)

# FILTRO DE ACUMULAÇÃO / CONSOLIDAÇÃO / CAIXOTE
ACCUMULATION_FILTER_ENABLED = True
ACCUMULATION_WINDOW_BOXES = 6
ACCUMULATION_MAX_ALTERNATIONS = 3
ACCUMULATION_MIN_RANGE_MULT = 2.0

def check_accumulation(boxes, box_to_check, window_size=6, max_alternations=3, min_range_mult=2.0, box_points=100):
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

    # 2. Amplitude dos últimos boxes anteriores ao box atual
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
    curr_close = box_to_check["close"]
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

# PARÂMETROS DE TRAILING STOP E LIMITES DIÁRIOS
MAE_TRAILING_STOP_ENABLED = True
DAILY_LIMITS_ENABLED = False
DAILY_PROFIT_TARGET = 1000.0
DAILY_STOP_LOSS = 800.0
DAILY_TRAILING_ENABLED = True
DAILY_TRAILING_TRIGGER = 800.0
DAILY_TRAILING_GIVEBACK = 250.0
DAILY_TARGET_HIT = False
DAILY_MAX_PROFIT_PEAK = 0.0
STRICT_FLOW_REGIME_ENABLED = True
HOLD_MAIN_UNTIL_FLOW_FLIP = True
LAST_CONFIG_MTIME = 0.0

def load_renko_config():
    global RENKO_R, BOX_POINTS, PYRAMID_TP_POINTS, STOP_LOSS_POINTS, MIN_DELTA_THRESHOLD, MIN_REVERSAL_DELTA
    global ACCUMULATION_FILTER_ENABLED, ACCUMULATION_WINDOW_BOXES, ACCUMULATION_MAX_ALTERNATIONS, ACCUMULATION_MIN_RANGE_MULT
    global MAE_TRAILING_STOP_ENABLED, DAILY_LIMITS_ENABLED, DAILY_PROFIT_TARGET, DAILY_STOP_LOSS
    global DAILY_TRAILING_ENABLED, DAILY_TRAILING_TRIGGER, DAILY_TRAILING_GIVEBACK, LAST_CONFIG_MTIME
    global STRICT_FLOW_REGIME_ENABLED, HOLD_MAIN_UNTIL_FLOW_FLIP
    cfg_file = os.path.join(os.path.dirname(__file__), "renko_config.json")
    if os.path.exists(cfg_file):
        try:
            mtime = os.path.getmtime(cfg_file)
            LAST_CONFIG_MTIME = mtime
            with open(cfg_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                old_pts = BOX_POINTS if 'BOX_POINTS' in globals() else 100
                if "renko_r" in data:
                    RENKO_R = int(data["renko_r"])
                    BOX_POINTS = RENKO_R * 5
                elif "box_points" in data:
                    BOX_POINTS = int(data["box_points"])
                    RENKO_R = max(1, BOX_POINTS // 5)
                PYRAMID_TP_POINTS = int(data.get("pyramid_tp_points", 50))
                STOP_LOSS_POINTS = int(data.get("stop_loss_points", 100))
                MIN_DELTA_THRESHOLD = float(data.get("min_delta_threshold", 250.0))
                MIN_REVERSAL_DELTA = float(data.get("min_reversal_delta", 75.0))
                STRICT_FLOW_REGIME_ENABLED = bool(data.get("strict_flow_regime_enabled", True))
                HOLD_MAIN_UNTIL_FLOW_FLIP = bool(data.get("hold_main_until_flow_flip", True))
                ACCUMULATION_FILTER_ENABLED = bool(data.get("accumulation_filter_enabled", True))
                ACCUMULATION_WINDOW_BOXES = int(data.get("accumulation_window_boxes", 6))
                ACCUMULATION_MAX_ALTERNATIONS = int(data.get("accumulation_max_alternations", 3))
                ACCUMULATION_MIN_RANGE_MULT = float(data.get("accumulation_min_range_mult", 2.0))
                MAE_TRAILING_STOP_ENABLED = bool(data.get("mae_trailing_stop_enabled", True))
                DAILY_LIMITS_ENABLED = bool(data.get("daily_limits_enabled", True))
                DAILY_PROFIT_TARGET = float(data.get("daily_profit_target", 1000.0))
                DAILY_STOP_LOSS = float(data.get("daily_stop_loss", 800.0))
                DAILY_TRAILING_ENABLED = bool(data.get("daily_trailing_enabled", True))
                DAILY_TRAILING_TRIGGER = float(data.get("daily_trailing_trigger", 800.0))
                DAILY_TRAILING_GIVEBACK = float(data.get("daily_trailing_giveback", 250.0))

                if 'RENKO_ENGINE' in globals() and RENKO_ENGINE and old_pts != BOX_POINTS:
                    RENKO_ENGINE.set_box_points(BOX_POINTS)

                regime_str = "ATIVO (Opção 1: Bloqueio Contra o Fluxo)" if STRICT_FLOW_REGIME_ENABLED else "OFF"
                print(f"⚙️ [CONFIG CARREGADA] Renko: {RENKO_R}R ({BOX_POINTS} pts) | TP Pirâmide: {PYRAMID_TP_POINTS} pts | Regime Fluxo: {regime_str} | Meta: R$ {DAILY_PROFIT_TARGET:.0f} | Stop: R$ {DAILY_STOP_LOSS:.0f}")
        except Exception as e:
            print(f"Erro ao carregar renko_config.json: {e}")

def check_config_reload():
    global LAST_CONFIG_MTIME
    cfg_file = os.path.join(os.path.dirname(__file__), "renko_config.json")
    if os.path.exists(cfg_file):
        try:
            mtime = os.path.getmtime(cfg_file)
            if mtime > LAST_CONFIG_MTIME:
                print(f"\n🔄 [HOT RELOAD] Alteração detectada em renko_config.json via Web! Sincronizando parâmetros...")
                load_renko_config()
        except Exception:
            pass

load_renko_config()

# JANELA OPERACIONAL (HORÁRIO DE BRASÍLIA)
TRADING_HOURS_ENABLED = True
START_TIME = "09:05"
STOP_ENTRIES_TIME = "17:40"

CLOSE_ALL_TIME = "17:50"

# WEBSOCKET BRIDGE
WS_HOST = "0.0.0.0"
WS_PORT = 8765

CONNECTED_CLIENTS = set()
RENKO_ENGINE = None
ORDER_MANAGER = None


# ==============================================================================
# MOTOR RENKO E FLUXO ATEMPORAL (DELTA E CVD)
# ==============================================================================
def normalizar_box_para_web(b):
    if not isinstance(b, dict):
        return b
    cvd = b.get("cvdAtClose", b.get("cvd_at_close", 0))
    ts = b.get("timeStart", b.get("time_start", b.get("timestamp", int(time.time() * 1000))))
    te = b.get("timeEnd", b.get("timestamp", ts))
    tc = b.get("ticksCount", b.get("ticks_count", 0))
    bv = b.get("buyVolume", b.get("buy_volume", 0))
    sv = b.get("sellVolume", b.get("sell_volume", 0))
    op = b.get("open", 0)
    cl = b.get("close", 0)
    hi = b.get("high", max(op, cl))
    lo = b.get("low", min(op, cl))
    delta = b.get("delta", bv - sv)
    return {
        **b,
        "open": op,
        "close": cl,
        "high": hi,
        "low": lo,
        "delta": delta,
        "cvdAtClose": cvd,
        "cvd_at_close": cvd,
        "timeStart": ts,
        "timeEnd": te,
        "timestamp": te,
        "ticksCount": tc,
        "ticks_count": tc,
        "totalVolume": b.get("totalVolume", bv + sv),
        "buyVolume": bv,
        "buy_volume": bv,
        "sellVolume": sv,
        "sell_volume": sv,
    }

class RenkoFlowEngine:
    def __init__(self, box_points=50):
        self.box_points = box_points
        self.boxes = []
        self.current_box = None
        self.cvd = 0.0
        self.last_flow_ha = None

    def set_box_points(self, points):
        old_points = self.box_points
        self.box_points = int(points)
        print(f"🔄 [MOTOR RENKO] Tamanho do box alterado de {old_points}p para {self.box_points}p ({self.box_points // 5}R)")

    def init_engine(self, initial_price, timestamp):
        base_price = round(initial_price / 5.0) * 5.0
        self.current_box = {
            "index": 0,
            "direction": "UP",
            "open": base_price,
            "close": base_price,
            "high": base_price,
            "low": base_price,
            "time_start": timestamp,
            "ticks_count": 0,
            "buy_volume": 0,
            "sell_volume": 0,
            "delta": 0,
            "cvd_at_close": 0
        }
        self.last_flow_ha = None
        print(f"[RENKO 10R] Inicializado no preço base: {base_price:.0f} pts")

    def _calc_flow_ha(self, box):
        cvd_val = float(box.get("cvd_at_close", box.get("cvdAtClose", self.cvd)))
        delta_val = float(box.get("delta", 0))
        buy_vol = float(box.get("buy_volume", box.get("buyVolume", 0)))
        sell_vol = float(box.get("sell_volume", box.get("sellVolume", 0)))

        raw_open = cvd_val - delta_val
        raw_close = cvd_val
        extra_buy = max(0.0, buy_vol - sell_vol) * 0.35
        extra_sell = max(0.0, sell_vol - buy_vol) * 0.35
        raw_high = max(raw_open, raw_close) + extra_buy
        raw_low = min(raw_open, raw_close) - extra_sell

        ha_close = (raw_open + raw_high + raw_low + raw_close) / 4.0
        if self.last_flow_ha is None:
            ha_open = (raw_open + raw_close) / 2.0
        else:
            ha_open = (self.last_flow_ha["open"] + self.last_flow_ha["close"]) / 2.0

        is_up = ha_close >= ha_open
        self.last_flow_ha = {"open": ha_open, "close": ha_close, "is_up": is_up}
        return "BUY" if is_up else "SELL"

    def get_flow_regime(self) -> str:
        """
        Determina o regime institucional de fluxo com base no saldo acumulado (CVD)
        e na persistência da direção do fluxo Heikin-Ashi.
        Evita falsos sinais causados por pullbacks ou ruídos de um único box.
        """
        if self.cvd > 2000:
            return "BUY"
        elif self.cvd < -2000:
            return "SELL"

        if len(self.boxes) >= 3:
            recent_boxes = self.boxes[-3:]
            recent_deltas = sum(b.get("delta", 0) for b in recent_boxes)
            up_count = sum(1 for b in recent_boxes if b.get("direction") == "UP")
            down_count = sum(1 for b in recent_boxes if b.get("direction") == "DOWN")
            if up_count >= 2 and recent_deltas > 0:
                return "BUY"
            elif down_count >= 2 and recent_deltas < 0:
                return "SELL"

        if self.last_flow_ha is not None:
            return "BUY" if self.last_flow_ha.get("is_up", True) else "SELL"
        return "BUY" if self.cvd >= 0 else "SELL"

    def load_history(self, boxes):
        if not boxes:
            return
        self.boxes = list(boxes)
        self.last_flow_ha = None
        for b in self.boxes:
            reg = self._calc_flow_ha(b)
            b["flow_regime"] = reg

        last_b = boxes[-1]
        self.current_box = {
            "index": len(self.boxes),
            "direction": last_b["direction"],
            "open": last_b["close"],
            "close": last_b["close"],
            "high": last_b["close"],
            "low": last_b["close"],
            "time_start": last_b.get("timeEnd", int(time.time() * 1000)),
            "ticks_count": 0,
            "buy_volume": 0,
            "sell_volume": 0,
            "delta": 0,
            "cvd_at_close": last_b.get("cvdAtClose", 0)
        }
        self.cvd = float(last_b.get("cvdAtClose", 0.0))
        reg_atual = self.get_flow_regime()
        print(f"📦 [MOTOR RENKO] {len(boxes)} boxes históricos ativos. Ponto: {last_b['close']:.0f} pts | Regime de Fluxo Atual: {reg_atual}")

    def process_tick(self, price, volume, aggressor, timestamp):
        tick_delta = volume if aggressor == "BUY" else (-volume if aggressor == "SELL" else 0)
        self.cvd += tick_delta

        if self.current_box is None:
            self.init_engine(price, timestamp)

        curr = self.current_box
        curr["ticks_count"] += 1
        if aggressor == "BUY":
            curr["buy_volume"] += volume
        elif aggressor == "SELL":
            curr["sell_volume"] += volume

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
            reg = self._calc_flow_ha(new_box)
            new_box["flow_regime"] = reg
            self.boxes.append(new_box)
            signal, reason = self.check_convergence(new_box)

            self.current_box = {
                "index": len(self.boxes),
                "direction": new_box["direction"],
                "open": new_box["close"],
                "close": price,
                "high": price,
                "low": price,
                "time_start": timestamp,
                "ticks_count": 0,
                "buy_volume": 0,
                "sell_volume": 0,
                "delta": 0,
                "cvd_at_close": self.cvd
            }

        return new_box, signal, reason

    def _create_closed_box(self, direction, box_open, box_close, curr, timestamp):
        t_start = curr.get("time_start", curr.get("timeStart", timestamp))
        ticks = curr.get("ticks_count", curr.get("ticksCount", 0))
        b_vol = curr.get("buy_volume", curr.get("buyVolume", 0))
        s_vol = curr.get("sell_volume", curr.get("sellVolume", 0))
        d_val = curr.get("delta", b_vol - s_vol)
        hi = max(curr.get("high", box_open), box_close if direction == "UP" else box_open)
        lo = min(curr.get("low", box_open), box_open if direction == "UP" else box_close)
        return {
            "index": len(self.boxes),
            "direction": direction,
            "open": box_open,
            "close": box_close,
            "high": hi,
            "low": lo,
            "ticksCount": ticks,
            "ticks_count": ticks,
            "totalVolume": b_vol + s_vol,
            "buyVolume": b_vol,
            "buy_volume": b_vol,
            "sellVolume": s_vol,
            "sell_volume": s_vol,
            "delta": d_val,
            "cvdAtClose": self.cvd,
            "cvd_at_close": self.cvd,
            "timeStart": t_start,
            "timeEnd": timestamp,
            "timestamp": timestamp,
            "isConvergence": False
        }

    def check_convergence(self, box):
        delta = box["delta"]
        direction = box["direction"]

        if direction == "UP" and delta >= MIN_DELTA_THRESHOLD:
            reason = f"Convergência COMPRA: Box {RENKO_R}R Alta + Delta +{delta} ctros"
            return "BUY", reason
        elif direction == "DOWN" and delta <= -MIN_DELTA_THRESHOLD:
            reason = f"Convergência VENDA: Box {RENKO_R}R Baixa + Delta {delta} ctros"
            return "SELL", reason

        # Em ausência de filtro extremo, o fechamento do box conduz a direção
        return direction, f"Fechamento Box {RENKO_R}R {direction} (Delta: {delta})"


STRATEGY_ACTIVE = True

# ==============================================================================
# GERENCIADOR DE ORDENS MT5 (PIRÂMIDE + CONFLUÊNCIA DE FLUXO)
# ==============================================================================
class MT5OrderManager:
    def __init__(self, symbol, contracts, magic_number):
        self.symbol = symbol
        self.contracts = float(contracts)
        self.magic_number = magic_number

    def get_filling_mode(self):
        sym_info = mt5.symbol_info(self.symbol)
        if sym_info is None:
            return mt5.ORDER_FILLING_RETURN
        fill = sym_info.filling_mode
        # B3 MT5: bit 1 (2) = IOC, bit 2 (4) = RETURN, bit 0 (1) = FOK
        if fill & 2:
            return mt5.ORDER_FILLING_IOC
        elif fill & 1:
            return mt5.ORDER_FILLING_FOK
        return mt5.ORDER_FILLING_RETURN

    def check_schedule(self):
        if not TRADING_HOURS_ENABLED:
            return True, False
        now_hm = datetime.now().strftime("%H:%M")
        if now_hm >= CLOSE_ALL_TIME:
            print(f"[HORÁRIO] Horário de zeragem obrigatória ({now_hm} >= {CLOSE_ALL_TIME}). Zerando...")
            self.close_all_positions()
            return False, True
        if now_hm < START_TIME or now_hm >= STOP_ENTRIES_TIME:
            print(f"[HORÁRIO] Fora da janela de entradas ({now_hm} fora de {START_TIME}-{STOP_ENTRIES_TIME}).")
            return False, False
        return True, False

    def execute_market_order(self, order_type, comment="", volume=None, sl_points=0, tp_points=0):
        can_trade, _ = self.check_schedule()
        if not can_trade:
            return False, 0

        point = mt5.symbol_info(self.symbol).point
        tick = mt5.symbol_info_tick(self.symbol)
        if not tick:
            print(f"[ERRO MT5] Não foi possível obter tick do símbolo {self.symbol}")
            return False, 0

        use_volume = float(volume) if volume is not None else self.contracts
        is_buy = order_type.upper() in ["BUY", "UP", "COMPRA"]
        order_type_str = "BUY" if is_buy else "SELL"
        entry_price = tick.ask if is_buy else tick.bid

        # Stop Loss e Take Profit
        sl_price = 0.0
        if sl_points > 0:
            sl_price = entry_price - (sl_points * point) if is_buy else entry_price + (sl_points * point)

        tp_price = 0.0
        if tp_points > 0:
            tp_price = entry_price + (tp_points * point) if is_buy else entry_price - (tp_points * point)

        order_tag = f"{ORDER_COMMENT}_{comment}"[:31]

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": self.symbol,
            "volume": use_volume,
            "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
            "price": entry_price,
            "sl": sl_price,
            "tp": tp_price,
            "deviation": 25,
            "magic": self.magic_number,
            "comment": order_tag,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": self.get_filling_mode(),
        }

        res = mt5.order_send(request)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"✅ ORDEM EXECUTADA: {order_type_str} {use_volume} ctros @ {entry_price:.0f} | SL: {sl_price:.0f} | TP: {tp_price:.0f} | Ticket #{res.order}")
            return True, res.order
        else:
            ret = res.retcode if res else "Nenhum resultado"
            desc = res.comment if res else "Sem detalhes"
            print(f"[ERRO MT5] RetCode={ret}, Desc={desc}")
            return False, 0

    def execute_pyramid_confluence(self, signal, box):
        # Normaliza a direção da ordem para BUY ou SELL
        if signal in ["BUY", "UP", "COMPRA"]:
            current_dir = "BUY"
        elif signal in ["SELL", "DOWN", "VENDA"]:
            current_dir = "SELL"
        else:
            return False, 0, "NONE", "Sinal inválido ou sem direção"

        positions = mt5.positions_get(symbol=self.symbol)
        active_positions = [p for p in positions if p.magic == self.magic_number] if positions else []

        has_opposite = False
        for pos in active_positions:
            is_pos_buy = pos.type == mt5.ORDER_TYPE_BUY
            if (current_dir == "BUY" and not is_pos_buy) or (current_dir == "SELL" and is_pos_buy):
                has_opposite = True
                break

        flow_regime = RENKO_ENGINE.get_flow_regime() if RENKO_ENGINE else current_dir

        # 1. Se o fluxo inverteu, aplica o FILTRO DE REGIME ESTREITO (Opção 1)
        if has_opposite:
            # Se a posição atual for a favor do fluxo institucional e o box for apenas um pullback contrário:
            if STRICT_FLOW_REGIME_ENABLED and HOLD_MAIN_UNTIL_FLOW_FLIP and current_dir != flow_regime:
                print(f"🛡️ [PULLBACK NO FLUXO] Box virou {current_dir}, mas o Fluxo Institucional (CVD) continua {flow_regime}. Posição Mãe mantida surfando sem zeragem prematura!")
                return False, 0, "HOLD_MAIN_PULLBACK", f"Pullback no fluxo: CVD continua {flow_regime}. Ordem Mãe preservada!"

            box_delta = box.get("delta", 0)
            if current_dir == "BUY" and box_delta < MIN_REVERSAL_DELTA:
                print(f"🛡️ [FILTRO REVERSÃO] Box virou ALTA, mas Delta ({box_delta}) < +{MIN_REVERSAL_DELTA}. Reversão bloqueada (ruído/pullback evitado)!")
                return False, 0, "BLOCKED_DELTA", f"Reversão fraca: Delta ({box_delta}) abaixo do mínimo ({MIN_REVERSAL_DELTA})"
            elif current_dir == "SELL" and box_delta > -MIN_REVERSAL_DELTA:
                print(f"🛡️ [FILTRO REVERSÃO] Box virou BAIXA, mas Delta ({box_delta}) > -{MIN_REVERSAL_DELTA}. Reversão bloqueada (ruído/pullback evitado)!")
                return False, 0, "BLOCKED_DELTA", f"Reversão fraca: Delta ({box_delta}) abaixo do mínimo ({MIN_REVERSAL_DELTA})"

            print(f"\n🔄 [INVERSÃO DE FLUXO CONFIRMADA] Delta ({box_delta}) e Regime ({flow_regime}) confirmaram virada! Zerando posições anteriores para virar a mão para {current_dir}!")
            self.close_all_positions()
            time.sleep(0.05)
            active_positions = []

        # 1.1 FILTRO DE REGIME DE FLUXO (Opção 1: Bloqueia compras no fluxo vendedor e vendas no fluxo comprador)
        if STRICT_FLOW_REGIME_ENABLED and current_dir != flow_regime:
            print(f"🛡️ [FILTRO REGIME DE FLUXO] Entrada de {current_dir} BLOQUEADA: Janela de Fluxo Institucional (CVD) está em modo {flow_regime}! Proibido operar contra a maré.")
            return False, 0, "BLOCKED_FLOW_REGIME", f"Contra a maré: Janela institucional de CVD está em modo {flow_regime}!"

        # 1.1 FILTRO DE GAP DE ABERTURA (Anti-Leilão / Anti-Salto)
        if box.get("isGap", False) or box.get("is_gap", False):
            gap_pts = box.get("gapPoints", box.get("gap_points", 0))
            print(f"🛡️ [FILTRO GAP DE ABERTURA] Entrada de {current_dir} BLOQUEADA: Salto de {gap_pts:+.0f} pts na abertura do pregão. Preservando capital até formação de range real!")
            return False, 0, "BLOCKED_GAP", f"Salto/GAP na abertura ({gap_pts:+.0f} pts). Aguardando range estável!"

        # 2. FILTRO DE ACUMULAÇÃO / CONSOLIDAÇÃO (Anti-Whipsaw / Caixote)
        if ACCUMULATION_FILTER_ENABLED and RENKO_ENGINE and len(RENKO_ENGINE.boxes) >= ACCUMULATION_WINDOW_BOXES:
            is_acc, is_break, acc_reason, r_min, r_max = check_accumulation(
                RENKO_ENGINE.boxes,
                box,
                window_size=ACCUMULATION_WINDOW_BOXES,
                max_alternations=ACCUMULATION_MAX_ALTERNATIONS,
                min_range_mult=ACCUMULATION_MIN_RANGE_MULT,
                box_points=BOX_POINTS
            )
            if is_acc:
                print(f"🛡️ [FILTRO ACUMULAÇÃO] Entrada de {current_dir} BLOQUEADA: {acc_reason}. Preservando capital contra falso rompimento!")
                return False, 0, "BLOCKED_ACCUMULATION", f"Caixote/Acumulação: {acc_reason}"
            elif is_break:
                print(f"🚀 [ROMPIMENTO CONFIRMADO] {acc_reason}! Entrada autorizada na explosão do caixote!")

        # 3. Verifica se a Ordem Mãe já existe
        has_main_order = False
        pyramid_count = 0
        for pos in active_positions:
            if "MAE" in pos.comment:
                has_main_order = True
            elif "PIR" in pos.comment:
                pyramid_count += 1

        if not has_main_order:
            # Exige Delta mínimo na entrada primária para evitar overtrading e entradas fracas (Fase 3)
            raw_delta = box.get("delta", 0)
            if (current_dir == "BUY" and raw_delta < MIN_DELTA_THRESHOLD) or (current_dir == "SELL" and raw_delta > -MIN_DELTA_THRESHOLD):
                print(f"🛡️ [FILTRO DELTA PRIMÁRIO] Entrada de {current_dir} pausada: Delta ({raw_delta:.0f}) abaixo do gatilho institucional ({MIN_DELTA_THRESHOLD:.0f} ctros).")
                return False, 0, "BLOCKED_DELTA_PRIMARY", f"Delta primário ({raw_delta:.0f}) abaixo do gatilho ({MIN_DELTA_THRESHOLD:.0f} ctros)"

            # Dispara Ordem Mãe de Surfe
            print(f"🟢 [ORDEM MÃE] Disparando {current_dir} ({MAIN_CONTRACTS} ct) no Box #{box['index']} | Delta: {raw_delta:+.0f} | Surfe com Trailing Stop")
            success, ticket = self.execute_market_order(
                order_type=current_dir,
                comment=f"MAE_{box['index']}",
                volume=MAIN_CONTRACTS,
                sl_points=STOP_LOSS_POINTS,
                tp_points=0
            )
            return success, ticket, "MAIN", f"Entrada Mãe {current_dir} executada a mercado! Delta: {raw_delta:+.0f}"
        elif pyramid_count < MAX_POSITIONS:
            # Dispara Pirâmide: saída exclusivamente no TP de +1 box ou na Inversão Total
            pyramid_num = pyramid_count + 1
            print(f"🔺 [PIRÂMIDE #{pyramid_num}] Disparando {current_dir} ({PYRAMID_CONTRACTS} ct) no Box #{box['index']} | Alvo +{PYRAMID_TP_POINTS} pts (Zeragem por TP ou Inversão)")
            success, ticket = self.execute_market_order(
                order_type=current_dir,
                comment=f"PIR_{pyramid_num}_{box['index']}",
                volume=PYRAMID_CONTRACTS,
                sl_points=STOP_LOSS_POINTS,
                tp_points=PYRAMID_TP_POINTS
            )
            return success, ticket, "PYRAMID", f"Pirâmide #{pyramid_num} {current_dir} executada (+{PYRAMID_TP_POINTS} pts TP)!"
        return False, 0, "NONE", "Sinal inválido ou sem direção"

    def check_hard_stop_loss(self, current_price):
        if STOP_LOSS_POINTS <= 0:
            return False
        positions = mt5.positions_get(symbol=self.symbol)
        if not positions:
            return False
        for pos in positions:
            if pos.magic == self.magic_number:
                is_buy = pos.type == mt5.ORDER_TYPE_BUY
                pts = (current_price - pos.price_open) if is_buy else (pos.price_open - current_price)
                if pts <= -STOP_LOSS_POINTS:
                    print(f"\n🚨 [STOP LOSS WATCHDOG] Posição #{pos.ticket} ({pos.comment}) bateu {pts:.0f} pts (SL Limite: -{STOP_LOSS_POINTS} pts)! Executando corte de risco a mercado!")
                    self.close_all_positions()
                    return True
        return False

    def close_all_positions(self):
        positions = mt5.positions_get(symbol=self.symbol)
        if not positions:
            return

        for pos in positions:
            if pos.magic != self.magic_number:
                continue
            is_buy = pos.type == mt5.ORDER_TYPE_BUY
            tick = mt5.symbol_info_tick(self.symbol)
            close_price = tick.bid if is_buy else tick.ask

            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": pos.ticket,
                "symbol": self.symbol,
                "volume": pos.volume,
                "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
                "price": close_price,
                "deviation": 25,
                "magic": self.magic_number,
                "comment": "Zeragem_RoboFluxo",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": self.get_filling_mode(),
            }
            res = mt5.order_send(req)
            if res.retcode == mt5.TRADE_RETCODE_DONE:
                print(f" Posicao #{pos.ticket} zerada com sucesso a {close_price:.0f} pts.")

    def update_trailing_stop_mae(self, box):
        """
        Ajusta dinamicamente o Stop Loss da Ordem Mãe:
        1. Breakeven: Quando o trade anda pelo menos 1 box a favor, move o SL para a entrada.
        2. Trailing Stop Renko: A cada novo box na direção, sobe o SL para o fundo/topo do box.
        """
        positions = mt5.positions_get(symbol=self.symbol)
        active_positions = [p for p in positions if p.magic == self.magic_number] if positions else []
        mae_pos = next((p for p in active_positions if "MAE" in p.comment), None)
        if not mae_pos:
            return

        is_buy = (mae_pos.type == mt5.ORDER_TYPE_BUY)
        current_sl = float(mae_pos.sl)
        entry_price = float(mae_pos.price_open)
        box_open = float(box["open"])

        # Para COMPRA: avança SL para a abertura do box fechado
        if is_buy and box["direction"] == "UP":
            suggested_sl = float(box_open)
            if (suggested_sl >= entry_price) and (suggested_sl > current_sl):
                req = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "position": mae_pos.ticket,
                    "symbol": self.symbol,
                    "sl": suggested_sl,
                    "tp": float(mae_pos.tp),
                }
                res = mt5.order_send(req)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    lucro_pts = suggested_sl - entry_price
                    tag = "BREAKEVEN" if suggested_sl == entry_price else f"LUCRO +{lucro_pts:.0f} pts"
                    print(f"🛡️ [TRAILING STOP MÃE] Ordem Mãe #{mae_pos.ticket} SL ajustado para {suggested_sl:.0f} pts ({tag})!")

        # Para VENDA: desce SL para a abertura do box fechado
        elif (not is_buy) and box["direction"] == "DOWN":
            suggested_sl = float(box_open)
            if (suggested_sl <= entry_price) and (current_sl == 0.0 or suggested_sl < current_sl):
                req = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "position": mae_pos.ticket,
                    "symbol": self.symbol,
                    "sl": suggested_sl,
                    "tp": float(mae_pos.tp),
                }
                res = mt5.order_send(req)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    lucro_pts = entry_price - suggested_sl
                    tag = "BREAKEVEN" if suggested_sl == entry_price else f"LUCRO +{lucro_pts:.0f} pts"
                    print(f"🛡️ [TRAILING STOP MÃE] Ordem Mãe #{mae_pos.ticket} SL ajustado para {suggested_sl:.0f} pts ({tag})!")

    def check_daily_limits(self):
        """
        Monitora limites financeiros diários:
        1. Meta de Lucro diária
        2. Stop Diário máximo
        3. Trailing Stop de Capital diário
        """
        global DAILY_TARGET_HIT, DAILY_MAX_PROFIT_PEAK
        if not DAILY_LIMITS_ENABLED:
            return True, ""

        if DAILY_TARGET_HIT:
            return False, "Meta diária ou Stop diário já atingido hoje."

        from datetime import timedelta
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        deals = mt5.history_deals_get(today - timedelta(hours=3), datetime.now())
        if not deals:
            return True, ""

        closed_deals = [d for d in deals if d.entry in [1, 2]]
        gross_p = sum(d.profit for d in closed_deals if d.profit > 0)
        gross_l = sum(abs(d.profit) for d in closed_deals if d.profit < 0)
        net_profit = gross_p - gross_l

        if net_profit > DAILY_MAX_PROFIT_PEAK:
            DAILY_MAX_PROFIT_PEAK = net_profit

        # 1. Meta Diária de Lucro
        if DAILY_PROFIT_TARGET > 0 and net_profit >= DAILY_PROFIT_TARGET:
            DAILY_TARGET_HIT = True
            print(f"\n🏆🏆 [META DIÁRIA ATINGIDA] Lucro Líquido: R$ {net_profit:.2f} >= Meta R$ {DAILY_PROFIT_TARGET:.2f}!")
            print(f"🔒 Encerrando posições e travando o pregão com vitória!\n")
            self.close_all_positions()
            return False, f"Meta Diária de R$ {DAILY_PROFIT_TARGET:.2f} atingida!"

        # 2. Stop Diário Máximo
        if DAILY_STOP_LOSS > 0 and net_profit <= -DAILY_STOP_LOSS:
            DAILY_TARGET_HIT = True
            print(f"\n🛑 [STOP DIÁRIO ATINGIDO] Perda Líquida: R$ {net_profit:.2f} <= Limite -R$ {DAILY_STOP_LOSS:.2f}!")
            print(f"🔒 Encerrando posições e protegendo conta até amanhã!\n")
            self.close_all_positions()
            return False, f"Stop Diário de R$ {DAILY_STOP_LOSS:.2f} atingido!"

        # 3. Trailing Stop de Capital
        if DAILY_TRAILING_ENABLED and DAILY_MAX_PROFIT_PEAK >= DAILY_TRAILING_TRIGGER:
            recuo = DAILY_MAX_PROFIT_PEAK - net_profit
            if recuo >= DAILY_TRAILING_GIVEBACK:
                DAILY_TARGET_HIT = True
                print(f"\n💰 [TRAILING STOP DIÁRIO] Lucro recuou de R$ {DAILY_MAX_PROFIT_PEAK:.2f} para R$ {net_profit:.2f} (recuo R$ {recuo:.2f}).")
                print(f"🔒 Travando o dia com lucro líquido de R$ {net_profit:.2f} garantido!\n")
                self.close_all_positions()
                return False, f"Trailing Stop Diário atingido!"

        return True, ""



def carregar_ticks_recentes(symbol="WINZ26", count=150):
    """
    Busca os últimos N ticks reais registrados no Times & Trades do MetaTrader 5
    """
    try:
        ref = mt5.symbol_info_tick(symbol)
        ref_time = int(ref.time) if ref else int(time.time())
        raw_ticks = mt5.copy_ticks_from(symbol, ref_time - (86400 * 3), count, mt5.COPY_TICKS_ALL)
        if raw_ticks is None or len(raw_ticks) == 0:
            return []
        out = []
        for t in raw_ticks[-count:]:
            p = float(t['last'] if t['last'] > 0 else (t['bid'] if t['bid'] > 0 else 0))
            if p <= 0:
                continue
            flags = int(t['flags'])
            aggr = "BUY" if (flags & mt5.TICK_FLAG_BUY) else ("SELL" if (flags & mt5.TICK_FLAG_SELL) else "CROSS")
            msc = int(t['time_msc'])
            out.append({
                "id": f"mt5-{msc}",
                "timestamp": msc,
                "timeStr": datetime.utcfromtimestamp(int(t['time'])).strftime("%H:%M:%S"),
                "price": p,
                "volume": int(t['volume'] if t['volume'] > 0 else 1),
                "aggressor": aggr,
                "buyerBroker": "XP Investimentos" if aggr == "BUY" else "Institucional B3",
                "sellerBroker": "Institucional B3" if aggr == "BUY" else "XP Investimentos",
                "isReal": True,
                "source": "MT5_REAL"
            })
        return out
    except Exception as e:
        print(f"Erro ao carregar ticks recentes do MT5: {e}")
        return []

def carregar_ordens_reais_mt5(dias=1):
    """
    Carrega as operações reais executadas no MetaTrader 5 agrupadas por posição (round-trip)
    """
    try:
        now = datetime.now()
        if dias <= 1:
            start_date = datetime(now.year, now.month, now.day)
        else:
            start_date = now - timedelta(days=dias)

        deals = mt5.history_deals_get(start_date, now)
        if not deals:
            return []

        positions_dict = {}
        for d in deals:
            pos_id = d.position_id
            if pos_id not in positions_dict:
                positions_dict[pos_id] = []
            positions_dict[pos_id].append(d)

        completed_trades = []
        for pos_id, d_list in positions_dict.items():
            entries = [d for d in d_list if d.entry == 0]
            exits = [d for d in d_list if d.entry in [1, 2]]
            if entries and exits:
                e = entries[0]
                x = exits[-1]
                pnl = sum(d.profit + getattr(d, 'commission', 0.0) + getattr(d, 'swap', 0.0) for d in exits)
                side = "BUY" if e.type == 0 else "SELL"
                pts = (x.price - e.price) if side == "BUY" else (e.price - x.price)
                t_entry = datetime.utcfromtimestamp(e.time).strftime("%H:%M:%S")
                t_exit = datetime.utcfromtimestamp(x.time).strftime("%H:%M:%S")
                completed_trades.append({
                    "id": f"ord-mt5-{pos_id}",
                    "ticket": pos_id,
                    "timestamp": int(e.time) * 1000,
                    "timeStr": t_entry,
                    "fillTimestamp": int(e.time) * 1000,
                    "fillTimeStr": t_entry,
                    "type": side,
                    "role": "MAIN",
                    "entryPrice": float(e.price),
                    "exitPrice": float(x.price),
                    "exitTimestamp": int(x.time) * 1000,
                    "exitTimeStr": t_exit,
                    "status": "CLOSED_PROFIT" if pnl >= 0 else "CLOSED_LOSS",
                    "exitReason": "TAKE_PROFIT" if pnl >= 0 else "STOP_LOSS",
                    "contracts": int(e.volume),
                    "pointsResult": round(pts, 0),
                    "financialResult": round(pnl, 2),
                    "triggerReason": f"Executado no MetaTrader 5 (Deal #{x.ticket})",
                    "source": "MT5_LIVE",
                    "isRealMT5": True
                })

        completed_trades.sort(key=lambda t: t["timestamp"], reverse=True)
        return completed_trades
    except Exception as e:
        print(f"Erro ao carregar ordens reais do MT5: {e}")
        return []

def carregar_historico_renko(symbol="WINZ26", box_pts=50, max_dias=2):
    """
    Carrega o histórico dos últimos N pregões a partir de barras M1 do MT5 em menos de 0.05s.
    Identifica gaps de abertura entre pregões, anota os saltos sem criar boxes fictícios
    e reconstrói a sequência contínua para exibir no gráfico e proteger contra saltos de leilão.
    """
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, max(1500, max_dias * 600))
    if rates is None or len(rates) == 0:
        return []

    dias = {}
    for r in rates:
        d = datetime.fromtimestamp(r["time"]).strftime("%Y-%m-%d")
        if d not in dias:
            dias[d] = []
        dias[d].append(r)

    dias_ordenados = sorted(dias.keys())[-max_dias:]
    todos_boxes = []
    prev_close = None
    cvd_acc = 0.0

    for d in dias_ordenados:
        r_list = dias[d]
        open_day = round(r_list[0]["open"] / 5.0) * 5.0
        gap_pts = 0.0
        is_gap = False
        if prev_close is not None:
            gap_pts = open_day - prev_close
            if abs(gap_pts) >= (box_pts * 1.5):
                is_gap = True

        curr_dir = "UP"
        last_close = open_day
        day_boxes = []
        d_formatado = datetime.strptime(d, "%Y-%m-%d").strftime("%d/%m")

        for r in r_list:
            o, h, l, c = r["open"], r["high"], r["low"], r["close"]
            vol = float(r["tick_volume"])
            t_ms = int(r["time"]) * 1000
            delta_bar = vol * 0.4 if c > o else (-vol * 0.4 if c < o else 0.0)

            pts_seq = [o, l, h, c] if c >= o else [o, h, l, c]
            for p in pts_seq:
                if curr_dir == "UP":
                    if p >= last_close + box_pts:
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "UP",
                            "open": last_close,
                            "close": last_close + box_pts,
                            "high": last_close + box_pts,
                            "low": last_close,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.7 if delta_bar > 0 else vol * 0.3),
                            "sellVolume": int(vol * 0.3 if delta_bar > 0 else vol * 0.7),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close += box_pts
                    elif p <= last_close - (box_pts * 2):
                        curr_dir = "DOWN"
                        prev_o = last_close - box_pts
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "DOWN",
                            "open": prev_o,
                            "close": prev_o - box_pts,
                            "high": prev_o,
                            "low": prev_o - box_pts,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.3),
                            "sellVolume": int(vol * 0.7),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close = prev_o - box_pts
                else:
                    if p <= last_close - box_pts:
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "DOWN",
                            "open": last_close,
                            "close": last_close - box_pts,
                            "high": last_close,
                            "low": last_close - box_pts,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.3),
                            "sellVolume": int(vol * 0.7),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close -= box_pts
                    elif p >= last_close + (box_pts * 2):
                        curr_dir = "UP"
                        prev_o = last_close + box_pts
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "UP",
                            "open": prev_o,
                            "close": prev_o + box_pts,
                            "high": prev_o + box_pts,
                            "low": prev_o,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.7),
                            "sellVolume": int(vol * 0.3),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close = prev_o + box_pts

        if day_boxes:
            day_boxes[0]["isDayStart"] = True
            day_boxes[0]["dayLabel"] = d_formatado
            if is_gap:
                day_boxes[0]["isGap"] = True
                day_boxes[0]["gapPoints"] = gap_pts
            prev_close = day_boxes[-1]["close"]
            todos_boxes.extend(day_boxes)

    return todos_boxes

# ==============================================================================
# WEBSOCKET SERVER & STREAM EM TEMPO REAL
# ==============================================================================
async def ws_handler(websocket):
    global RENKO_R, BOX_POINTS, PYRAMID_TP_POINTS, STOP_LOSS_POINTS, HOLD_MAIN_UNTIL_FLOW_FLIP, MIN_DELTA_THRESHOLD
    CONNECTED_CLIENTS.add(websocket)
    try:
        acc = mt5.account_info()
        tick = mt5.symbol_info_tick(SYMBOL)
        current_price = tick.last if (tick and tick.last > 0) else (tick.bid if tick else 172500)

        init_msg = {
            "type": "ACCOUNT_INFO",
            "data": {
                "login": acc.login if acc else "DEMO",
                "broker": acc.server if acc else "MetaTrader 5 Live",
                "balance": acc.balance if acc else 0.0,
                "equity": acc.equity if acc else 0.0,
            }
        }
        await websocket.send(json.dumps(init_msg))

        market_data_msg = {
            "type": "INITIAL_DATA",
            "data": {
                "symbol": SYMBOL,
                "currentPrice": current_price,
                "bid": tick.bid if tick else current_price,
                "ask": tick.ask if tick else current_price,
                "cvd": RENKO_ENGINE.cvd if RENKO_ENGINE else 0.0,
                "renko_r": RENKO_R,
                "box_points": BOX_POINTS,
                "pyramid_tp": PYRAMID_TP_POINTS,
                "boxes": [normalizar_box_para_web(b) for b in RENKO_ENGINE.boxes[-5000:]] if (RENKO_ENGINE and RENKO_ENGINE.boxes) else [],
                "currentBox": RENKO_ENGINE.current_box if RENKO_ENGINE else None,
                "ticks": carregar_ticks_recentes(SYMBOL, 120),
                "orders": carregar_ordens_reais_mt5(1),
            }
        }
        await websocket.send(json.dumps(market_data_msg))

        async for message in websocket:
            data = json.loads(message)
            action = data.get("action")
            if action == "ORDER_SEND":
                ORDER_MANAGER.execute_market_order(
                    order_type=data.get("type", "BUY"),
                    volume=data.get("contracts", 1),
                    sl_points=data.get("sl", 0),
                    tp_points=data.get("tp", 0),
                    comment="Web_Manual"
                )
            elif action == "CLOSE_POSITIONS":
                ORDER_MANAGER.close_all_positions()
            elif action == "UPDATE_CONFIG":
                cfg_data = data.get("config", {})
                if "stop_loss_points" in cfg_data or "stopLossPoints" in cfg_data:
                    STOP_LOSS_POINTS = int(cfg_data.get("stop_loss_points", cfg_data.get("stopLossPoints", STOP_LOSS_POINTS)))
                if "pyramid_tp_points" in cfg_data or "pyramidTpPoints" in cfg_data:
                    PYRAMID_TP_POINTS = int(cfg_data.get("pyramid_tp_points", cfg_data.get("pyramidTpPoints", PYRAMID_TP_POINTS)))
                if "hold_main_until_flow_flip" in cfg_data or "holdMainUntilFlip" in cfg_data:
                    HOLD_MAIN_UNTIL_FLOW_FLIP = bool(cfg_data.get("hold_main_until_flow_flip", cfg_data.get("holdMainUntilFlip", HOLD_MAIN_UNTIL_FLOW_FLIP)))
                if "min_delta_threshold" in cfg_data or "minDeltaThreshold" in cfg_data:
                    MIN_DELTA_THRESHOLD = float(cfg_data.get("min_delta_threshold", cfg_data.get("minDeltaThreshold", MIN_DELTA_THRESHOLD)))

                # Salva permanentemente no arquivo renko_config.json
                try:
                    cfg_file = os.path.join(os.path.dirname(__file__), "renko_config.json")
                    if os.path.exists(cfg_file):
                        with open(cfg_file, "r", encoding="utf-8") as f:
                            saved_cfg = json.load(f)
                        saved_cfg["stop_loss_points"] = STOP_LOSS_POINTS
                        saved_cfg["pyramid_tp_points"] = PYRAMID_TP_POINTS
                        saved_cfg["hold_main_until_flow_flip"] = HOLD_MAIN_UNTIL_FLOW_FLIP
                        saved_cfg["min_delta_threshold"] = MIN_DELTA_THRESHOLD
                        saved_cfg["last_updated"] = datetime.now().isoformat()
                        with open(cfg_file, "w", encoding="utf-8") as f:
                            json.dump(saved_cfg, f, indent=4)
                except Exception as err:
                    print(f"Erro ao salvar renko_config.json: {err}")

                print(f"⚡ [CONFIG WEBSOCKET] Parâmetros sincronizados e gravados em renko_config.json: SL={STOP_LOSS_POINTS}p | TP Pir={PYRAMID_TP_POINTS}p | Limiar Delta={MIN_DELTA_THRESHOLD} | Flip={HOLD_MAIN_UNTIL_FLOW_FLIP}")
                
                # Confirmação imediata para a interface web
                await broadcast_to_web({
                    "type": "CONFIG_SAVED",
                    "data": {
                        "success": True,
                        "stopLossPoints": STOP_LOSS_POINTS,
                        "pyramidTpPoints": PYRAMID_TP_POINTS,
                        "minDeltaThreshold": MIN_DELTA_THRESHOLD,
                        "holdMainUntilFlip": HOLD_MAIN_UNTIL_FLOW_FLIP,
                        "timestamp": int(time.time() * 1000)
                    }
                })
            elif action == "UNLOCK_DAILY_LIMITS":
                global DAILY_TARGET_HIT, DAILY_LIMITS_ENABLED
                DAILY_TARGET_HIT = False
                DAILY_LIMITS_ENABLED = False
                print("🔓 [DESTRAVAMENTO MANUAL] Trava diária de capital desativada via Web!")
                await broadcast_to_web({
                    "type": "DAILY_LIMIT_STATUS",
                    "data": { "locked": False, "reason": "Destravado pelo operador via interface" }
                })
            elif action == "GET_HISTORY":
                max_d = int(data.get("maxDias", 2))
                print(f"[REQUISICAO HISTORICO] Solicitado periodo de {max_d} pregoes...")
                reloaded = carregar_historico_renko(SYMBOL, BOX_POINTS, max_dias=max_d)
                if reloaded and RENKO_ENGINE:
                    RENKO_ENGINE.load_history(reloaded)
                curr_tick = mt5.symbol_info_tick(SYMBOL)
                curr_p = curr_tick.last if curr_tick else (reloaded[-1]["close"] if reloaded else 0)
                resp = {
                    "type": "INITIAL_DATA",
                    "data": {
                        "symbol": SYMBOL,
                        "currentPrice": curr_p,
                        "boxes": [normalizar_box_para_web(b) for b in (RENKO_ENGINE.boxes[-5000:] if RENKO_ENGINE else (reloaded or []))],
                        "cvd": RENKO_ENGINE.cvd if RENKO_ENGINE else 0.0,
                        "currentBox": RENKO_ENGINE.current_box if RENKO_ENGINE else None,
                        "ticks": carregar_ticks_recentes(SYMBOL, 120),
                        "orders": carregar_ordens_reais_mt5(max_d),
                    }
                }
                await websocket.send(json.dumps(resp))
            elif action == "SET_RENKO_CONFIG":
                if "renko_r" in data:
                    RENKO_R = int(data["renko_r"])
                    BOX_POINTS = RENKO_R * 5
                elif "box_points" in data:
                    BOX_POINTS = int(data["box_points"])
                    RENKO_R = max(1, BOX_POINTS // 5)
                
                PYRAMID_TP_POINTS = BOX_POINTS
                if RENKO_ENGINE:
                    RENKO_ENGINE.set_box_points(BOX_POINTS)
                print(f"⚡ [AJUSTE RENKO] Parâmetro atualizado: {RENKO_R}R ({BOX_POINTS} pts) | TP Pirâmide: +{PYRAMID_TP_POINTS} pts")
                await broadcast_to_web({
                    "type": "RENKO_CONFIG_UPDATED",
                    "data": {
                        "renko_r": RENKO_R,
                        "box_points": BOX_POINTS,
                        "pyramid_tp": PYRAMID_TP_POINTS
                    }
                })
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CONNECTED_CLIENTS.discard(websocket)

async def broadcast_to_web(msg_dict):
    if not CONNECTED_CLIENTS:
        return
    msg_str = json.dumps(msg_dict)
    disconnected = set()
    for client in list(CONNECTED_CLIENTS):
        try:
            await client.send(msg_str)
        except Exception:
            disconnected.add(client)
    for d in disconnected:
        CONNECTED_CLIENTS.discard(d)

async def mt5_stream_loop():
    last_tick_time_msc = 0
    ref_tick = mt5.symbol_info_tick(SYMBOL)
    if ref_tick:
        last_tick_time_msc = ref_tick.time_msc
        price = ref_tick.last if ref_tick.last > 0 else ref_tick.bid
        if not RENKO_ENGINE.boxes:
            RENKO_ENGINE.init_engine(price, ref_tick.time_msc)
        print(f"📡 Monitorando Times & Trades ao vivo em '{SYMBOL}' a partir de {price:.0f} pts...")

    last_mirror_broadcast = 0.0
    while True:
        try:
            ref = mt5.symbol_info_tick(SYMBOL)
            if not ref:
                await asyncio.sleep(0.1)
                continue

            # Busca os ticks mais recentes utilizando o timestamp do servidor da XP MT5
            server_time_sec = int(ref.time)
            ticks = mt5.copy_ticks_from(SYMBOL, server_time_sec - 3, 200, mt5.COPY_TICKS_ALL)

            if ticks is not None and len(ticks) > 0:
                for tick in ticks:
                    tick_msc = int(tick['time_msc'])
                    if tick_msc <= last_tick_time_msc:
                        continue
                    last_tick_time_msc = tick_msc

                    price = float(tick['last'] if tick['last'] > 0 else (tick['bid'] if tick['bid'] > 0 else ref.bid))
                    if price <= 0:
                        continue
                    vol = int(tick['volume'] if tick['volume'] > 0 else (tick['volume_real'] if tick['volume_real'] > 0 else 1))
                    flags = int(tick['flags'])
                    aggressor = "BUY" if (flags & mt5.TICK_FLAG_BUY) else ("SELL" if (flags & mt5.TICK_FLAG_SELL) else "CROSS")

                    # Transmite tick ao Terminal Web
                    await broadcast_to_web({
                        "type": "TICK",
                        "data": {
                            "id": f"mt5-{tick_msc}",
                            "isReal": True,
                            "source": "MT5_REAL",
                            "timestamp": tick_msc,
                            "timeStr": datetime.utcfromtimestamp(tick_msc/1000).strftime('%H:%M:%S.%f')[:-3],
                            "price": price,
                            "volume": vol,
                            "aggressor": aggressor
                        }
                    })

                    # Monitor de Stop Loss Imediato (Watchdog de Segurança)
                    if ORDER_MANAGER and ORDER_MANAGER.check_hard_stop_loss(price):
                        await broadcast_to_web({
                            "type": "AUDIT_EVENT",
                            "data": {
                                "timestamp": int(tick_msc),
                                "status": "STOP_LOSS",
                                "action": "STOP_LOSS_TRIGGERED",
                                "signal": "EXIT",
                                "boxPrice": price,
                                "reason": f"Stop Loss acionado a {price:.0f} pts (-{STOP_LOSS_POINTS} pts de perda máxima atingida)!"
                            }
                        })

                    new_box, signal, reason = RENKO_ENGINE.process_tick(price, vol, aggressor, tick_msc)

                    if new_box:
                        print(f"[{datetime.utcfromtimestamp(tick_msc/1000).strftime('%H:%M:%S')}] Box {RENKO_R}R #{new_box['index']}: {new_box['direction']} | {new_box['open']:.0f} -> {new_box['close']:.0f} | Delta: {new_box['delta']}")
                        await broadcast_to_web({"type": "BOX_CLOSED", "data": new_box})

                        # FASE 1: Trailing Stop & Breakeven dinâmico na Ordem Mãe
                        if MAE_TRAILING_STOP_ENABLED:
                            ORDER_MANAGER.update_trailing_stop_mae(new_box)

                        # FASE 2: Gestor Financeiro Diário (Meta de Ganho & Stop Diário)
                        can_trade, limit_reason = ORDER_MANAGER.check_daily_limits()

                        if signal:
                            if not can_trade:
                                print(f"🛑 [TRAVA DIÁRIA] Entrada de {signal} BLOQUEADA: {limit_reason}")
                                await broadcast_to_web({
                                    "type": "AUDIT_EVENT",
                                    "data": {
                                        "timestamp": int(tick_msc),
                                        "status": "BLOCKED",
                                        "action": "BLOCKED_DAILY_LIMIT",
                                        "signal": signal,
                                        "boxIndex": new_box.get("index"),
                                        "boxPrice": new_box.get("close"),
                                        "delta": new_box.get("delta"),
                                        "reason": f"Trava Diária: {limit_reason}",
                                        "ticket": 0
                                    }
                                })
                            else:
                                ret = ORDER_MANAGER.execute_pyramid_confluence(signal, new_box)
                                if len(ret) == 4:
                                    success, ticket, role, reason_text = ret
                                else:
                                    success, ticket, role = ret[:3]
                                    reason_text = "Executado" if success else "Bloqueado"

                                await broadcast_to_web({
                                    "type": "AUDIT_EVENT",
                                    "data": {
                                        "timestamp": int(tick_msc),
                                        "status": "EXECUTED" if success else "BLOCKED",
                                        "action": role,
                                        "signal": signal,
                                        "boxIndex": new_box.get("index"),
                                        "boxPrice": new_box.get("close"),
                                        "delta": new_box.get("delta"),
                                        "reason": reason_text,
                                        "ticket": ticket if success else 0
                                    }
                                })

                                if success:
                                    await broadcast_to_web({
                                        "type": "ORDER_RESULT",
                                        "ticket": ticket,
                                        "role": role,
                                        "orderType": signal,
                                        "status": "DONE"
                                    })
            # Espelhamento em tempo real das posições MT5 ao vivo para o terminal web (a cada 1 segundo)
            now_sec = time.time()
            if now_sec - last_mirror_broadcast > 1.0:
                last_mirror_broadcast = now_sec
                check_config_reload()
                positions = mt5.positions_get(symbol=SYMBOL)
                pos_list = []
                if positions:
                    for p in positions:
                        if p.magic == MAGIC_NUMBER:
                            pts = (p.price_current - p.price_open) if p.type == 0 else (p.price_open - p.price_current)
                            pos_list.append({
                                "ticket": p.ticket,
                                "type": "BUY" if p.type == mt5.ORDER_TYPE_BUY else "SELL",
                                "volume": p.volume,
                                "price_open": p.price_open,
                                "price_current": p.price_current,
                                "profit": round(p.profit, 2),
                                "points": round(pts, 0),
                                "comment": p.comment
                            })
                real_orders = carregar_ordens_reais_mt5(1)
                await broadcast_to_web({
                    "type": "LIVE_MIRROR",
                    "data": {
                        "positions": pos_list,
                        "openCount": len(pos_list),
                        "orders": real_orders,
                        "todayPnL": round(sum(o["financialResult"] for o in real_orders), 2)
                    }
                })

            await asyncio.sleep(0.02)
        except Exception as e:
            await asyncio.sleep(0.1)

def is_mt5_process_running() -> bool:
    try:
        import subprocess
        res = subprocess.run(["tasklist", "/fi", "imagename eq terminal64.exe", "/fo", "csv"], capture_output=True, text=True)
        return "terminal64.exe" in res.stdout.lower()
    except Exception:
        return True

async def main():
    global ORDER_MANAGER, RENKO_ENGINE
    if not is_mt5_process_running():
        print(f"[AVISO] MetaTrader 5 não está aberto no Windows. Abra o MetaTrader 5 pela Área de Trabalho e execute novamente.")
        sys.exit(1)

    if not mt5.initialize():
        print(f"[AVISO] Falha ao conectar à instância aberta do MT5. Verifique se o MT5 está rodando.")
        sys.exit(1)

    acc = mt5.account_info()
    print("=" * 65)
    print(f"🤖 ROBÔ FLUXO B3 CONECTADO AO METATRADER 5")
    print(f"Conta: {acc.login} | Servidor: {acc.server} | Nome: {acc.name}")
    print(f"Ativo Alvo: {SYMBOL} | Box Renko: {RENKO_R}R ({BOX_POINTS} pts)")
    print(f"Modo: Conta Demo/Simulador XP Investimentos")
    print("=" * 65)

    RENKO_ENGINE = RenkoFlowEngine(box_points=BOX_POINTS)
    print("📚 Carregando histórico dos últimos 2 pregões para detecção de GAPs e continuidade de gráfico...")
    hist_boxes = carregar_historico_renko(SYMBOL, BOX_POINTS, max_dias=2)
    if hist_boxes:
        RENKO_ENGINE.load_history(hist_boxes)
        gaps_count = sum(1 for b in hist_boxes if b.get("isGap"))
        print(f"✅ Histórico carregado com sucesso: {len(hist_boxes)} boxes ativos | {gaps_count} GAPs identificados e filtrados!")
    else:
        print("ℹ️ Nenhum histórico prévio encontrado. O motor iniciará a partir do primeiro tick ao vivo.")

    ORDER_MANAGER = MT5OrderManager(symbol=SYMBOL, contracts=MAIN_CONTRACTS, magic_number=MAGIC_NUMBER)

    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    print(f" Servidor WebSocket Bridge ATIVO em ws://{WS_HOST}:{WS_PORT}")
    print(f" Clique em 'Conectar MT5' no terminal web (http://localhost:3000)!\n")

    try:
        await asyncio.gather(server.wait_closed(), mt5_stream_loop())
    except KeyboardInterrupt:
        print("\nEncerrando conexão com o MT5...")
    finally:
        mt5.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
