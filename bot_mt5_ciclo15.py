LAST_BACKFILL_CACHE = {}
"""

========================================================================================

ROBÔ QUANTITATIVO MT5: PIRÂMIDE & CONFLUÊNCIA DE FLUXO RENKO 10R (TP 50p + SURFE) - CICLO 15

========================================================================================

Ativo: WINZ26 (Mini-Índice B3)

Estratégia: PIRÂMIDE EM CADA BOX VERDE/VERMELHO (TP 50p) + ORDEM MÃE ABERTA ATÉ INVERSÃO

Modo de Conta: HEDGE

Ponte WebSocket: ws://0.0.0.0:8765

========================================================================================

"""



import sys

if hasattr(sys.stdout, "reconfigure"):

    sys.stdout.reconfigure(encoding="utf-8")



import time

import json

import secrets

import asyncio

from datetime import datetime, timezone, timedelta

import MetaTrader5 as mt5

import threading

MT5_LOCK = threading.Lock()

LAST_BACKFILL_PAYLOAD = None

LAST_BACKFILL_TIME = 0

import websockets



# ==============================================================================

# CONFIGURAÇÕES DA ESTRATÉGIA E MODO DE OPERAÇÃO

# ==============================================================================

SUPPORTED_ASSETS = {
    "WIN": {
        "symbol": "WINZ26",
        "continuous": "WIN$",
        "label": "Mini-Índice B3",
        "decimals": 0,
        "tick_size": 5.0,
        "point_value": 0.2,
        "box_points": 50.0,
        "min_delta": 150,
        "magic": 150101,
        "contracts": 2,
        "sl_points": 50.0,
        "tp_points": 100.0,
        "partial_points": 50.0,
    },
    "WDO": {
        "symbol": "WDOZ26",
        "continuous": "WDO$",
        "label": "Mini-Dólar B3",
        "decimals": 1,
        "tick_size": 0.5,
        "point_value": 10.0,
        "box_points": 5.0,
        "min_delta": 30,
        "magic": 150201,
        "contracts": 1,
        "sl_points": 5.0,
        "tp_points": 10.0,
        "partial_points": 5.0,
    },
    "BTCBR": {
        "symbol": "BITX26",
        "continuous": "BIT$",
        "label": "Bitcoin B3 (BTCBR / BIT)",
        "decimals": 0,
        "tick_size": 20.0,
        "point_value": 0.1,
        "box_points": 100.0,
        "min_delta": 20,
        "magic": 150301,
        "contracts": 1,
        "sl_points": 200.0,
        "tp_points": 400.0,
        "partial_points": 200.0,
    },
    "BTC": {
        "symbol": "BITX26",
        "continuous": "BIT$",
        "label": "Bitcoin B3 (BTCBR / BIT)",
        "decimals": 0,
        "tick_size": 20.0,
        "point_value": 0.1,
        "box_points": 100.0,
        "min_delta": 20,
        "magic": 150301,
        "contracts": 1,
        "sl_points": 200.0,
        "tp_points": 400.0,
        "partial_points": 200.0,
    },
}



SYMBOL = "WINZ26"

ASSET_LABEL = "Mini-Índice B3"

ASSET_DECIMALS = 0

ASSET_TICK_SIZE = 5

ASSET_POINT_VALUE = 0.2

ACCOUNT_MODE = "HEDGE"

STRATEGY_MODE = "PYRAMID_FLOW_CONFLUENCE"

MAX_POSITIONS = 10



# Offset do servidor XP MT5 (que grava horário BRT diretamente como epoch UTC):

# Somar +3h converte para epoch UTC real, fazendo new Date(ts) no navegador bater com o relógio BRT.

MT5_BRT_OFFSET_SEC = 3 * 3600

MT5_BRT_OFFSET_MSC = MT5_BRT_OFFSET_SEC * 1000



# CONFIGURAÇÕES DA PIRÂMIDE & CONFLUÊNCIA

PYRAMID_TP_POINTS = 50

PYRAMID_SL_POINTS = 0

PYRAMID_CONTRACTS = 1

MAIN_CONTRACTS = 1

HOLD_MAIN_UNTIL_FLIP = True

CLOSE_ALL_ON_FLIP = True



PYRAMID_ENTRY_TYPE = "MARKET_ON_CLOSE"

MAIN_BREAKEVEN_ON_PYR_TP = True



ENTRY_TRIGGER_TYPE = "MARKET_ON_CLOSE"

PULLBACK_TARGET = "BOX_OPEN"

PULLBACK_CUSTOM_POINTS = 25

PULLBACK_MAX_BOXES_WAIT = 2



BOX_POINTS = 50

MIN_DELTA_THRESHOLD = 150

REQUIRE_CVD_EXTREME = False



ADAPTIVE_THRESHOLD_ENABLED = False

REGIME_LOOKBACK_BOXES = 20



STOP_LOSS_POINTS = 50

TAKE_PROFIT_POINTS = 100



ENABLE_PARTIAL_EXIT = False

PARTIAL_POINTS = 50

PARTIAL_CONTRACTS = 1

MOVE_SL_BREAKEVEN_ON_PARTIAL = True

BREAKEVEN_OFFSET_POINTS = 5



TRAILING_STOP = False

TRAILING_ACTIVATION_POINTS = 60

TRAILING_DISTANCE_POINTS = 50



MAX_DAILY_LOSS = 500

MAX_DAILY_PROFIT = 1000

MAX_DAILY_TRADES = 10



MAGIC_NUMBER = 102030

MANUAL_ORDER_MAGIC = 999999

ORDER_COMMENT = "Renko10R_Flow"



TRADING_HOURS_ENABLED = True

START_TIME = "08:55"

STOP_ENTRIES_TIME = "17:30"

CLOSE_ALL_TIME = "17:30"



# ==============================================================================

# SEGURANÇA DA PONTE

# ==============================================================================

AUTH_TOKEN = "AUTO_PIN_ON_FIRST_CONNECT"

REQUIRE_AUTH = True



MAX_CONTRACTS_PER_ORDER = 2

MAX_ORDERS_PER_MINUTE = 12



ENTRY_ACTIONS = {"ORDER_SEND"}

TRADE_ACTIONS = {"ORDER_SEND", "ORDER_PARTIAL_CLOSE", "ORDER_MODIFY_SL", "CLOSE_POSITIONS"}



HISTORY_MAX_DAYS = 10

HISTORY_CHUNK_TICKS = 1500

HISTORY_VOLUME_FALLBACK_RATIO = 0.8



WS_HOST = "0.0.0.0"

WS_PORT = 8765



CLIENT_STATES = {}





def get_peer_ip(websocket):

    try:

        return websocket.remote_address[0]

    except Exception:

        return "origem desconhecida"





def client_state(websocket):

    state = CLIENT_STATES.get(websocket)

    if state is None:

        state = {

            "authenticated": not REQUIRE_AUTH,

            "armed": not REQUIRE_AUTH,

            "order_times": [],

        }

        CLIENT_STATES[websocket] = state

    return state





async def send_json(websocket, payload):

    await websocket.send(json.dumps(payload))





def check_trade_allowed(state, data, action):

    if REQUIRE_AUTH and not state["authenticated"]:

        return False, "conexão não autenticada (token ausente ou errado)"

    if action in ENTRY_ACTIONS and not state["armed"]:

        return False, "ponte EM SEGURO: ligue o Robô no app para liberar entradas"

    if action == "ORDER_SEND":

        try:

            volume = float(data.get("contracts", 1) or 1)

        except (TypeError, ValueError):

            volume = 1.0

        if volume > MAX_CONTRACTS_PER_ORDER:

            return False, f"volume {volume:.0f} ctros acima do teto de {MAX_CONTRACTS_PER_ORDER}"

        now_ts = time.time()

        state["order_times"] = [t for t in state["order_times"] if now_ts - t < 60.0]

        if len(state["order_times"]) >= MAX_ORDERS_PER_MINUTE:

            return False, f"teto de {MAX_ORDERS_PER_MINUTE} ordens por minuto atingido"

        state["order_times"].append(now_ts)

    return True, ""





class RegimeMeter:

    MIN_BOXES_WARMUP = 20

    MIN_MINUTES_WARMUP = 15

    MAX_RECORDS = 2000



    def __init__(self, lookback_boxes=20):

        self.lookback = max(5, min(100, int(lookback_boxes) or 20))

        self.reset()



    @staticmethod

    def _clamp(v, lo, hi):

        return max(lo, min(hi, v))



    def reset(self):

        self.records = []

        self.day_key = None

        self.day_vol_sum = 0

        self.day_pos_sum = 0

        self.day_pos_n = 0

        self.day_neg_sum = 0

        self.day_neg_n = 0

        self.session_start = 0

        self.last_factor = 1.0

        self.last_buy = 1.0

        self.last_sell = 1.0



    def feed_closed_box(self, ts_msc, total_volume, delta):

        key = datetime.fromtimestamp(ts_msc / 1000).strftime("%Y-%m-%d")

        if self.day_key != key:

            self.reset()

            self.day_key = key

            self.session_start = ts_msc



        vol = max(0, int(total_volume or 0))

        dlt = int(delta or 0)



        day_boxes = len(self.records) + 1

        day_mean_vol = (self.day_vol_sum + vol) / day_boxes

        win = self.records[-self.lookback:]

        win_mean_vol = sum(r[1] for r in win) / len(win) if win else day_mean_vol



        day_pos_mean = self.day_pos_sum / self.day_pos_n if self.day_pos_n > 0 else 0

        day_neg_mean = self.day_neg_sum / self.day_neg_n if self.day_neg_n > 0 else 0

        win_pos = [r[2] for r in win if r[2] > 0]

        win_neg = [-r[2] for r in win if r[2] < 0]

        win_pos_mean = sum(win_pos) / len(win_pos) if win_pos else day_pos_mean

        win_neg_mean = sum(win_neg) / len(win_neg) if win_neg else day_neg_mean



        warm = (day_boxes >= self.MIN_BOXES_WARMUP

               and ts_msc - self.session_start >= self.MIN_MINUTES_WARMUP * 60 * 1000)



        self.last_factor = self._clamp(win_mean_vol / day_mean_vol, 0.5, 3.0) if (warm and day_mean_vol > 0) else 1.0

        self.last_buy = self._clamp(win_pos_mean / day_pos_mean, 0.5, 3.0) if (warm and day_pos_mean > 0) else 1.0

        self.last_sell = self._clamp(win_neg_mean / day_neg_mean, 0.5, 3.0) if (warm and day_neg_mean > 0) else 1.0



        hour = datetime.fromtimestamp(ts_msc / 1000).hour

        self.records.append((hour, vol, dlt, self.last_factor))

        if len(self.records) > self.MAX_RECORDS:

            self.records = self.records[-self.MAX_RECORDS:]

        self.day_vol_sum += vol

        if dlt > 0:

            self.day_pos_sum += dlt

            self.day_pos_n += 1

        elif dlt < 0:

            self.day_neg_sum += -dlt

            self.day_neg_n += 1

        return self.last_factor



    def get_adaptive_limit(self, base_threshold, side):

        dir_factor = self.last_buy if side == "BUY" else self.last_sell

        return round(base_threshold * self._clamp(self.last_factor * dir_factor, 0.5, 3.0))





class RenkoFlowEngine:
    def __init__(self, symbol="WINZ26", box_points=50.0, tick_size=5.0, min_delta_threshold=150):
        self.symbol = symbol
        self.box_points = box_points
        self.tick_size = tick_size
        self.min_delta_threshold = min_delta_threshold
        self.boxes = []
        self.current_box = None
        self.cvd = 0.0
        self.regime_meter = RegimeMeter(REGIME_LOOKBACK_BOXES)

    def init_engine(self, initial_price, timestamp):
        base_price = round(initial_price / self.tick_size) * self.tick_size

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

        print(f"[RENKO 10R] Inicializado em {base_price:.1f} pts", flush=True)



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

            self.boxes.append(new_box)

            new_box["regime_factor"] = self.regime_meter.feed_closed_box(

                new_box["timestamp"], new_box["buy_volume"] + new_box["sell_volume"], new_box["delta"]

            )

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

            "timestamp": timestamp

        }



    def check_convergence(self, box):
        delta = box["delta"]
        direction = box["direction"]
        adaptive = ADAPTIVE_THRESHOLD_ENABLED
        base_thresh = self.min_delta_threshold
        limit_buy = self.regime_meter.get_adaptive_limit(base_thresh, "BUY") if adaptive else base_thresh
        limit_sell = self.regime_meter.get_adaptive_limit(base_thresh, "SELL") if adaptive else base_thresh

        factor_lbl = f" | volume factor {self.regime_meter.last_factor:.2f}x" if adaptive else ""



        if STRATEGY_MODE == "PYRAMID_FLOW_CONFLUENCE":

            if direction == "UP":

                if adaptive and delta < limit_buy:

                    return None, ""

                return "BUY", f"Pirâmide Confluência Alta: Bloco Verde #{box['index']} (Δ {delta} vs limiar {limit_buy}{factor_lbl})"

            elif direction == "DOWN":

                if adaptive and delta > -limit_sell:

                    return None, ""

                return "SELL", f"Pirâmide Confluência Baixa: Bloco Vermelho #{box['index']} (Δ {delta} vs limiar {-limit_sell}{factor_lbl})"



        if direction == "UP" and delta >= limit_buy:

            reason = f"Convergência COMPRA: Box 10R Alta + Delta +{delta} ctros (limiar {limit_buy}{factor_lbl})"

            return "BUY", reason

        elif direction == "DOWN" and delta <= -limit_sell:

            reason = f"Convergência VENDA: Box 10R Baixa + Delta {delta} ctros (limiar {-limit_sell}{factor_lbl})"

            return "SELL", reason



        return None, ""





class MT5OrderManager:

    def __init__(self, symbol, contracts, magic_number):

        self.symbol = symbol

        self.contracts = float(contracts)

        self.magic_number = magic_number

        self.daily_pnl = 0.0

        self.pending_orders = []

        self.main_tickets = {}

        self.pyramid_tickets = {}



    def get_filling_mode(self):

        sym_info = mt5.symbol_info(self.symbol)

        if sym_info is None:

            return mt5.ORDER_FILLING_RETURN

        if sym_info.filling_mode & mt5.SYMBOL_FILLING_IOC:

            return mt5.ORDER_FILLING_IOC

        elif sym_info.filling_mode & mt5.SYMBOL_FILLING_FOK:

            return mt5.ORDER_FILLING_FOK

        return mt5.ORDER_FILLING_RETURN



    def calculate_pullback_price(self, signal, box):

        box_open = box["open"]

        box_close = box["close"]

        if PULLBACK_TARGET == "BOX_OPEN":

            return box_open

        elif PULLBACK_TARGET == "BOX_50_PCT":

            return (box_open + box_close) / 2.0

        else:

            pts = PULLBACK_CUSTOM_POINTS

            return (box_close - pts) if signal == "BUY" else (box_close + pts)



    def check_schedule(self):

        if not TRADING_HOURS_ENABLED:

            return True, False

        now_hm = datetime.now().strftime("%H:%M")

        if now_hm >= CLOSE_ALL_TIME:

            print(f"[HORÁRIO] Horário de zeragem atingido ({now_hm} >= {CLOSE_ALL_TIME}). Zerando posições...")

            self.close_all_positions()

            return False, True

        if now_hm < START_TIME or now_hm >= STOP_ENTRIES_TIME:

            print(f"[HORÁRIO] Fora da janela de entradas ({now_hm} fora de {START_TIME}-{STOP_ENTRIES_TIME}). Ordem ignorada.")

            return False, False

        return True, False



    def place_pullback_limit_order(self, signal, box, comment=""):

        can_trade, _ = self.check_schedule()

        if not can_trade:

            return False, 0, 0.0



        limit_price = self.calculate_pullback_price(signal, box)

        point = mt5.symbol_info(self.symbol).point



        if signal == "BUY":

            order_type = mt5.ORDER_TYPE_BUY_LIMIT

            sl_price = limit_price - (STOP_LOSS_POINTS * point)

            tp_price = limit_price + (TAKE_PROFIT_POINTS * point)

        else:

            order_type = mt5.ORDER_TYPE_SELL_LIMIT

            sl_price = limit_price + (STOP_LOSS_POINTS * point)

            tp_price = limit_price - (TAKE_PROFIT_POINTS * point)



        order_tag = f"{ORDER_COMMENT} {signal[:1]}#{box['index']}"[:31]



        request = {

            "action": mt5.TRADE_ACTION_PENDING,

            "symbol": self.symbol,

            "volume": self.contracts,

            "type": order_type,

            "price": limit_price,

            "sl": sl_price,

            "tp": tp_price,

            "deviation": 20,

            "magic": self.magic_number,

            "comment": order_tag,

            "type_time": mt5.ORDER_TIME_GTC,

            "type_filling": self.get_filling_mode(),

        }



        res = mt5.order_send(request)

        if res.retcode != mt5.TRADE_RETCODE_DONE:

            print(f"[ERRO MT5 PENDENTE] RetCode={res.retcode}, Desc={res.comment}")

            return False, 0, limit_price



        ticket = res.order

        print(f"✅ ORDEM LIMITADA POSICIONADA NO BOOK! Ticket #{ticket}")

        self.pending_orders.append({

            "ticket": ticket,

            "signal": signal,

            "limit_price": limit_price,

            "box_index": box["index"]

        })

        return True, ticket, limit_price



    def calculate_pyramid_entry_level(self, signal, box):

        if PYRAMID_ENTRY_TYPE == "BOX_50_LIMIT":

            return (box["open"] + box["close"]) / 2.0

        if PYRAMID_ENTRY_TYPE == "BOX_OPEN_LIMIT":

            return box["open"]

        return box["close"]



    def place_pyramid_limit_order(self, signal, box, comment="", volume=None, sl_points=0, tp_points=0):

        can_trade, _ = self.check_schedule()

        if not can_trade:

            return False, 0, 0.0



        sym_info = mt5.symbol_info(self.symbol)

        tick = mt5.symbol_info_tick(self.symbol)

        if not sym_info or not tick:

            return False, 0, 0.0



        point = sym_info.point

        use_volume = float(volume) if volume is not None else self.contracts

        limit_price = self.calculate_pyramid_entry_level(signal, box)

        market_price = tick.ask if signal == "BUY" else tick.bid



        if (signal == "BUY" and limit_price >= market_price) or (signal == "SELL" and limit_price <= market_price):

            print(f"[LIMIT PIRÂMIDE] Nível {limit_price:.1f} já foi alcançado por {signal}, então a limitada não foi enviada.")

            return False, 0, limit_price



        order_type = mt5.ORDER_TYPE_BUY_LIMIT if signal == "BUY" else mt5.ORDER_TYPE_SELL_LIMIT

        sl_price = 0.0

        tp_price = 0.0

        if sl_points > 0:

            sl_price = limit_price - (sl_points * point) if signal == "BUY" else limit_price + (sl_points * point)

        if tp_points > 0:

            tp_price = limit_price + (tp_points * point) if signal == "BUY" else limit_price - (tp_points * point)



        order_tag = f"{ORDER_COMMENT} {comment}"[:31]

        request = {

            "action": mt5.TRADE_ACTION_PENDING,

            "symbol": self.symbol,

            "volume": use_volume,

            "type": order_type,

            "price": limit_price,

            "sl": sl_price,

            "tp": tp_price,

            "deviation": 20,

            "magic": self.magic_number,

            "comment": order_tag,

            "type_time": mt5.ORDER_TIME_GTC,

            "type_filling": self.get_filling_mode(),

        }



        res = mt5.order_send(request)

        if res.retcode != mt5.TRADE_RETCODE_DONE:

            print(f"[ERRO MT5 LIMIT PIRÂMIDE] RetCode={res.retcode}, Desc={res.comment}")

            return False, 0, limit_price



        self.pending_orders.append({

            "ticket": res.order,

            "signal": signal,

            "limit_price": limit_price,

            "box_index": box["index"]

        })

        return True, res.order, limit_price



    def place_websocket_limit_order(self, signal, limit_price, comment="", volume=None, sl_points=0, tp_points=0, magic=None):

        can_trade, _ = self.check_schedule()

        if not can_trade or limit_price <= 0:

            return False, 0



        sym_info = mt5.symbol_info(self.symbol)

        if not sym_info:

            return False, 0

        point = sym_info.point

        use_volume = float(volume) if volume is not None else self.contracts

        order_type = mt5.ORDER_TYPE_BUY_LIMIT if signal == "BUY" else mt5.ORDER_TYPE_SELL_LIMIT

        sl_price = 0.0

        tp_price = 0.0

        if sl_points > 0:

            sl_price = limit_price - (sl_points * point) if signal == "BUY" else limit_price + (sl_points * point)

        if tp_points > 0:

            tp_price = limit_price + (tp_points * point) if signal == "BUY" else limit_price - (tp_points * point)



        request = {

            "action": mt5.TRADE_ACTION_PENDING,

            "symbol": self.symbol,

            "volume": use_volume,

            "type": order_type,

            "price": float(limit_price),

            "sl": sl_price,

            "tp": tp_price,

            "deviation": 20,

            "magic": int(magic) if magic else self.magic_number,

            "comment": f"{ORDER_COMMENT} {comment}"[:31],

            "type_time": mt5.ORDER_TIME_GTC,

            "type_filling": self.get_filling_mode(),

        }

        res = mt5.order_send(request)

        if res.retcode == mt5.TRADE_RETCODE_DONE:

            print(f"⏳ [WEB LIMIT] {signal} {use_volume} ctro(s) posicionada em {limit_price:.1f} | Ticket #{res.order}")

            return True, res.order

        print(f"[ERRO MT5 WEB LIMIT] RetCode={res.retcode}, Desc={res.comment}")

        return False, 0



    def move_main_to_breakeven(self, direction):

        sym_info = mt5.symbol_info(self.symbol)

        point = sym_info.point if sym_info else 1.0

        offset = BREAKEVEN_OFFSET_POINTS * point

        for ticket in list(self.main_tickets.keys()):

            if self.main_tickets[ticket] != direction:

                continue

            positions = mt5.positions_get(ticket=ticket)

            if not positions:

                self.main_tickets.pop(ticket, None)

                continue

            pos = positions[0]

            be_sl = pos.price_open + offset if direction == "BUY" else pos.price_open - offset

            current_sl = pos.sl if pos.sl else 0.0

            improves = current_sl <= 0 or (be_sl > current_sl if direction == "BUY" else be_sl < current_sl)

            if not improves:

                continue

            self.modify_stop_loss(ticket, be_sl)



    def watch_closed_pyramids(self):

        if not MAIN_BREAKEVEN_ON_PYR_TP or not self.pyramid_tickets:

            return

        positions = mt5.positions_get(symbol=self.symbol)

        open_tickets = set(p.ticket for p in (positions or []) if p.magic == self.magic_number)

        for ticket in list(self.pyramid_tickets.keys()):

            if ticket in open_tickets:

                continue

            direction = self.pyramid_tickets.pop(ticket)

            print(f"🎯 [TP DA PIRÂMIDE #{ticket} {direction}] Movendo ordem mãe para o breakeven...")

            self.move_main_to_breakeven(direction)



    def check_and_clean_expired_pending(self, current_box_index):

        to_remove = []

        for p in self.pending_orders:

            if current_box_index - p["box_index"] >= PULLBACK_MAX_BOXES_WAIT:

                req = {

                    "action": mt5.TRADE_ACTION_REMOVE,

                    "order": p["ticket"],

                    "magic": self.magic_number

                }

                mt5.order_send(req)

                to_remove.append(p)

        for r in to_remove:

            self.pending_orders.remove(r)



    def execute_market_order(self, order_type, comment="", volume=None, sl_points=None, tp_points=None, magic=None):

        can_trade, _ = self.check_schedule()

        if not can_trade:

            return False, 0



        point = mt5.symbol_info(self.symbol).point

        tick = mt5.symbol_info_tick(self.symbol)

        if not tick:

            return False, 0



        use_volume = float(volume) if volume is not None else self.contracts

        is_buy = order_type == "BUY"

        entry_price = tick.ask if is_buy else tick.bid



        sl_val = sl_points if sl_points is not None else STOP_LOSS_POINTS

        sl_price = (entry_price - (sl_val * point) if is_buy else entry_price + (sl_val * point)) if sl_val > 0 else 0.0



        tp_val = tp_points if tp_points is not None else TAKE_PROFIT_POINTS

        tp_price = (entry_price + (tp_val * point) if is_buy else entry_price - (tp_val * point)) if tp_val > 0 else 0.0



        order_tag = f"{ORDER_COMMENT} {comment}"[:31]



        request = {

            "action": mt5.TRADE_ACTION_DEAL,

            "symbol": self.symbol,

            "volume": use_volume,

            "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,

            "price": entry_price,

            "sl": sl_price,

            "tp": tp_price,

            "deviation": 20,

            "magic": int(magic) if magic else self.magic_number,

            "comment": order_tag,

            "type_time": mt5.ORDER_TIME_GTC,

            "type_filling": self.get_filling_mode(),

        }

        res = mt5.order_send(request)

        if res.retcode == mt5.TRADE_RETCODE_DONE:

            print(f"✅ ORDEM EXECUTADA: {order_type} {use_volume} ctros @ {entry_price:.1f} | Ticket #{res.order}")

            return True, res.order

        else:

            print(f"[ERRO MT5] RetCode={res.retcode}, Desc={res.comment}")

        return False, 0



    def execute_pyramid_confluence(self, signal, box):

        positions = mt5.positions_get(symbol=self.symbol)

        active_positions = [p for p in (positions or []) if p.magic == self.magic_number]



        current_dir = signal

        has_opposite = False



        for pos in active_positions:

            is_pos_buy = pos.type == mt5.ORDER_TYPE_BUY

            if (current_dir == "BUY" and not is_pos_buy) or (current_dir == "SELL" and is_pos_buy):

                has_opposite = True

                break



        if has_opposite:

            print(f"\n🔄 [INVERSÃO DE FLUXO DETECTADA] Zerando as posições do robô (magic {self.magic_number}) para virar para {current_dir}!")

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

            if PYRAMID_ENTRY_TYPE != "MARKET_ON_CLOSE":

                success, ticket, placed = self.place_pyramid_limit_order(

                    current_dir,

                    box,

                    comment=f"MAE_{box['index']}",

                    volume=MAIN_CONTRACTS,

                    sl_points=0,

                    tp_points=0

                )

                if success:

                    self.main_tickets[ticket] = current_dir

                return success, ticket, "MAIN"



            print(f"🟢 [ABRINDO ORDEM MÃE] {current_dir} {MAIN_CONTRACTS} ctro(s) no Box #{box['index']}")

            success, ticket = self.execute_market_order(

                order_type=current_dir,

                comment=f"MAE_{box['index']}",

                volume=MAIN_CONTRACTS,

                sl_points=0,

                tp_points=0

            )

            if success:

                self.main_tickets[ticket] = current_dir

            return success, ticket, "MAIN"

        else:

            pyramid_num = pyramid_count + 1

            if PYRAMID_ENTRY_TYPE != "MARKET_ON_CLOSE":

                success, ticket, placed = self.place_pyramid_limit_order(

                    current_dir,

                    box,

                    comment=f"PIR_{pyramid_num}_{box['index']}",

                    volume=PYRAMID_CONTRACTS,

                    sl_points=PYRAMID_SL_POINTS,

                    tp_points=PYRAMID_TP_POINTS

                )

                if success:

                    self.pyramid_tickets[ticket] = current_dir

                return success, ticket, "PYRAMID"



            success, ticket = self.execute_market_order(

                order_type=current_dir,

                comment=f"PIR_{pyramid_num}_{box['index']}",

                volume=PYRAMID_CONTRACTS,

                sl_points=PYRAMID_SL_POINTS,

                tp_points=PYRAMID_TP_POINTS

            )

            if success:

                self.pyramid_tickets[ticket] = current_dir

            return success, ticket, "PYRAMID"



    def close_partial_position(self, ticket, partial_volume, new_sl=None, magic=None):

        positions = mt5.positions_get(ticket=ticket)

        if not positions:

            positions = mt5.positions_get(symbol=self.symbol)

        if not positions:

            return False



        pos = positions[0]

        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY

        tick = mt5.symbol_info_tick(self.symbol)

        price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask



        request = {

            "action": mt5.TRADE_ACTION_DEAL,

            "position": pos.ticket,

            "symbol": self.symbol,

            "volume": float(partial_volume),

            "type": close_type,

            "price": price,

            "deviation": 20,

            "magic": int(magic) if magic else self.magic_number,

            "comment": f"Parcial #{pos.ticket}",

            "type_time": mt5.ORDER_TIME_GTC,

            "type_filling": self.get_filling_mode(),

        }



        res = mt5.order_send(request)

        if res.retcode == mt5.TRADE_RETCODE_DONE:

            if new_sl is not None:

                self.modify_stop_loss(pos.ticket, new_sl)

            return True

        return False



    def modify_stop_loss(self, ticket, new_sl, magic=None):

        positions = mt5.positions_get(ticket=ticket)

        if not positions:

            positions = mt5.positions_get(symbol=self.symbol)

        if not positions:

            return False



        pos = positions[0]

        request = {

            "action": mt5.TRADE_ACTION_SLTP,

            "position": pos.ticket,

            "symbol": self.symbol,

            "sl": float(new_sl),

            "tp": float(pos.tp),

            "magic": int(magic) if magic else self.magic_number

        }

        res = mt5.order_send(request)

        return res.retcode == mt5.TRADE_RETCODE_DONE



    def close_all_positions(self, side=None, magic="robot"):

        positions = mt5.positions_get(symbol=self.symbol)

        if not positions:

            return True

        side_type = {"BUY": mt5.ORDER_TYPE_BUY, "SELL": mt5.ORDER_TYPE_SELL}.get(side)

        magic_filter = self.magic_number if magic == "robot" else (int(magic) if magic not in (None, "ALL", "all") else None)

        closed_n = 0

        pnl_brl = 0.0

        for pos in positions:

            if side_type is not None and pos.type != side_type:

                continue

            if magic_filter is not None and pos.magic != magic_filter:

                continue

            closed_n += 1

            close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY

            tick = mt5.symbol_info_tick(self.symbol)

            price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask

            dir_sign = 1.0 if pos.type == mt5.ORDER_TYPE_BUY else -1.0

            pnl_brl += (price - pos.price_open) * dir_sign * ASSET_POINT_VALUE * pos.volume

            req = {

                "action": mt5.TRADE_ACTION_DEAL,

                "position": pos.ticket,

                "symbol": self.symbol,

                "volume": pos.volume,

                "type": close_type,

                "price": price,

                "deviation": 20,

                "magic": magic_filter if magic_filter is not None else self.magic_number,

                "comment": "Zerar Terminal Web",

                "type_time": mt5.ORDER_TIME_GTC,

                "type_filling": self.get_filling_mode(),

            }

            mt5.order_send(req)

        alvo = f"lado {side}" if side_type is not None else "posições"

        donos = f"magic {magic_filter}" if magic_filter is not None else "TODOS os magics"

        print(f"🛑 {alvo} zeradas a mercado ({closed_n} posição(ões), {donos}) | PnL aproximado: R$ {pnl_brl:.2f}.")

        return True





CONNECTED_CLIENTS = set()

ORDER_MANAGER = None

ENGINES = {}
ORDER_MANAGERS = {}

def get_asset_spec(sym):
    sym_u = str(sym).upper()
    for k, v in SUPPORTED_ASSETS.items():
        if v["symbol"] == sym_u or sym_u.startswith(k) or k in sym_u:
            return v
    return SUPPORTED_ASSETS["WIN"]

def get_or_create_engine(sym):
    if sym in ENGINES:
        return ENGINES[sym]
    spec = get_asset_spec(sym)
    eng = RenkoFlowEngine(
        symbol=sym,
        box_points=spec["box_points"],
        tick_size=spec["tick_size"],
        min_delta_threshold=spec.get("min_delta", 150)
    )
    ENGINES[sym] = eng
    return eng

def get_or_create_order_manager(sym):
    if sym in ORDER_MANAGERS:
        return ORDER_MANAGERS[sym]
    spec = get_asset_spec(sym)
    mgr = MT5OrderManager(
        symbol=sym,
        contracts=spec.get("contracts", 1),
        magic_number=spec.get("magic", MAGIC_NUMBER)
    )
    ORDER_MANAGERS[sym] = mgr
    return mgr


RENKO_ENGINE = None





def fetch_mt5_deals(limit=1000, days=30):

    with MT5_LOCK:

        past = datetime.now() - timedelta(days=days)

        deals = mt5.history_deals_get(past, datetime.now())

        if not deals:

            return []

        closed_deals = []

        for d in deals:

            if d.entry == mt5.DEAL_ENTRY_OUT or d.profit != 0.0:

                closed_deals.append({

                    'ticket': int(d.ticket),

                    'order': int(d.order),

                    'time': int(d.time) * 1000,

                    'timeStr': datetime.fromtimestamp(d.time).strftime('%d/%m %H:%M:%S'),

                    'symbol': str(d.symbol),

                    'type': 'BUY' if d.type == mt5.DEAL_TYPE_BUY else 'SELL',

                    'volume': float(d.volume),

                    'price': float(d.price),

                    'profit': float(d.profit),

                    'commission': float(d.commission),

                    'swap': float(d.swap),

                    'comment': str(d.comment or ''),

                    'magic': int(d.magic)

                })

        if limit and len(closed_deals) > limit:

            return closed_deals[-limit:]

        return closed_deals



def fetch_mt5_positions():

    with MT5_LOCK:

        pos = mt5.positions_get()

        if not pos:

            return []

        positions_list = []

        for p in pos:

            positions_list.append({

                'ticket': int(p.ticket),

                'time': int(p.time) * 1000,

                'timeStr': datetime.fromtimestamp(p.time).strftime('%H:%M:%S'),

                'symbol': str(p.symbol),

                'type': 'BUY' if p.type == mt5.POSITION_TYPE_BUY else 'SELL',

                'volume': float(p.volume),

                'priceOpen': float(p.price_open),

                'priceCurrent': float(p.price_current),

                'profit': float(p.profit),

                'sl': float(p.sl),

                'tp': float(p.tp),

                'magic': int(p.magic),

                'comment': str(p.comment or '')

            })

        return positions_list



async def send_mt5_equity_data(websocket, limit=1000, days=30):

    with MT5_LOCK:

        acc = mt5.account_info()

    deals = await asyncio.to_thread(fetch_mt5_deals, limit, days)

    positions = await asyncio.to_thread(fetch_mt5_positions)

    await send_json(websocket, {

        "type": "MT5_EQUITY_UPDATE",

        "data": {

            "balance": acc.balance if acc else 0.0,

            "equity": acc.equity if acc else 0.0,

            "floatingProfit": acc.profit if acc else 0.0,

            "margin": acc.margin if acc else 0.0,

            "marginFree": acc.margin_free if acc else 0.0,

            "accountLogin": acc.login if acc else 0,

            "brokerCompany": acc.company if acc else "MetaTrader 5",

            "deals": deals,

            "positions": positions

        }

    })



async def send_account_info(websocket):

    with MT5_LOCK:

        acc = mt5.account_info()

    state = client_state(websocket)

    deals = await asyncio.to_thread(fetch_mt5_deals, 500, 30)

    positions = await asyncio.to_thread(fetch_mt5_positions)

    await send_json(websocket, {

        "type": "ACCOUNT_INFO",

        "data": {

            "login": acc.login if acc else 0,

            "broker": acc.company if acc else "MetaTrader 5",

            "balance": acc.balance if acc else 0.0,

            "equity": acc.equity if acc else 0.0,

            "floatingProfit": acc.profit if acc else 0.0,

            "margin": acc.margin if acc else 0.0,

            "marginFree": acc.margin_free if acc else 0.0,

            "deals": deals,

            "positions": positions,

            "entryTriggerType": ENTRY_TRIGGER_TYPE,

            "pullbackTarget": PULLBACK_TARGET,

            "partialExit": ENABLE_PARTIAL_EXIT,

            "trailingStop": TRAILING_STOP,

            "requireAuth": REQUIRE_AUTH,

            "armed": state["armed"],

            "symbol": SYMBOL,

            "decimals": ASSET_DECIMALS,

            "pointValue": ASSET_POINT_VALUE,

            "robotMagic": MAGIC_NUMBER,

            "manualMagic": MANUAL_ORDER_MAGIC,

            "maxContractsPerOrder": MAX_CONTRACTS_PER_ORDER,

            "maxOrdersPerMinute": MAX_ORDERS_PER_MINUTE

        }

    })





async def send_today_session_backfill(websocket, target_symbol=None):
    """Envia os candles M1 do pregão de hoje convertidos em ticks para popular o gráfico
    imediatamente ao conectar, com suporte a cache multi-ativo e proteção multithread MT5."""
    global LAST_BACKFILL_CACHE
    sym = target_symbol or SYMBOL
    now = time.time()

    cached = LAST_BACKFILL_CACHE.get(sym)
    if cached and (now - cached["time"] < 45):
        await send_json(websocket, cached["payload"])
        print(f" 📊 Gráfico do dia ({sym}) enviado do CACHE para {get_peer_ip(websocket)}", flush=True)
        return

    def _safe_fetch_rates():
        with MT5_LOCK:
            return mt5.copy_rates_from_pos(sym, mt5.TIMEFRAME_M1, 0, 600)

    try:
        rates = None
        for attempt in range(4):
            rates = await asyncio.to_thread(_safe_fetch_rates)
            if rates is not None and len(rates) > 0:
                break
            await asyncio.sleep(0.1)

        if rates is None or len(rates) == 0:
            if cached:
                await send_json(websocket, cached["payload"])
                print(f" 📊 Gráfico do dia ({sym}) enviado do cache anterior para {get_peer_ip(websocket)}", flush=True)
                return
            print(f" ⚠️ [AVISO BACKFILL] MT5 não retornou rates M1 para {sym}", flush=True)
            return

        last_day = datetime.fromtimestamp(int(rates[-1]["time"]), timezone.utc).strftime("%Y-%m-%d")
        today_rates = [
            r for r in rates
            if datetime.fromtimestamp(int(r["time"]), timezone.utc).strftime("%Y-%m-%d") == last_day
        ]
        dec = 1 if "WDO" in sym or "DOL" in sym else 0
        bf_ticks = []
        for r in today_rates:
            base_msc = (int(r["time"]) + MT5_BRT_OFFSET_SEC) * 1000
            o = round(float(r["open"]), dec)
            h = round(float(r["high"]), dec)
            l = round(float(r["low"]), dec)
            c = round(float(r["close"]), dec)
            vol = max(4, int(r["tick_volume"] or 4))
            v_step = max(1, vol // 4)
            is_bull = c >= o
            steps = [
                (o, v_step, "BUY" if is_bull else "SELL", 0),
                (l if is_bull else h, v_step, "SELL" if is_bull else "BUY", 15000),
                (h if is_bull else l, v_step, "BUY" if is_bull else "SELL", 35000),
                (c, max(1, vol - 3 * v_step), "BUY" if is_bull else "SELL", 55000),
            ]
            for p, v, agg, off in steps:
                t_msc = base_msc + off
                bf_ticks.append({
                    "id": f"mt5-bf-{sym}-{t_msc}",
                    "symbol": sym,
                    "timestamp": t_msc,
                    "timeStr": datetime.fromtimestamp(t_msc / 1000).strftime("%H:%M:%S"),
                    "price": p,
                    "volume": v,
                    "aggressor": agg,
                })

        payload = {
            "type": "SESSION_BACKFILL",
            "symbol": sym,
            "data": {
                "ticks": bf_ticks,
                "bars": len(today_rates),
                "date": last_day,
                "symbol": sym,
                "source": "MT5_M1_ESTIMATED"
            }
        }
        LAST_BACKFILL_CACHE[sym] = {"payload": payload, "time": now}
        await send_json(websocket, payload)
        print(f" 📊 Gráfico do dia ({sym} - {last_day}) enviado: {len(today_rates)} barras M1 ({len(bf_ticks)} ticks) para {get_peer_ip(websocket)}", flush=True)

    except Exception as exc:
        print(f" ⚠️ [ERRO BACKFILL] Falha ao processar M1 de {sym}: {exc}", flush=True)

async def ws_handler(websocket):
    global SYMBOL, ASSET_LABEL, ASSET_DECIMALS, ASSET_TICK_SIZE, ASSET_POINT_VALUE, BOX_POINTS, LAST_BACKFILL_PAYLOAD
    global AUTH_TOKEN, ORDER_MANAGER, RENKO_ENGINE, LAST_TICK_TIMES, LAST_BACKFILL_CACHE

    peer = get_peer_ip(websocket)

    CONNECTED_CLIENTS.add(websocket)

    state = client_state(websocket)



    print(f" 🔌 {peer} conectou — aguardando AUTH com o token antes de entregar qualquer dado", flush=True)



    try:

        async for message in websocket:

            try:

                data = json.loads(message)

            except json.JSONDecodeError:

                continue

            action = data.get("action")



            if action == "AUTH":

                provided = str(data.get("token") or "")

                if len(provided) >= 16:

                    AUTH_TOKEN = provided

                matches = bool(AUTH_TOKEN) and secrets.compare_digest(provided, AUTH_TOKEN)

                wants_armed = bool(data.get("armed", False))

                state["authenticated"] = matches

                state["armed"] = matches and wants_armed

                await send_json(websocket, {

                    "type": "AUTH_RESULT",

                    "data": {

                        "ok": state["authenticated"],

                        "requireToken": REQUIRE_AUTH,

                        "armed": state["armed"],

                        "maxContractsPerOrder": MAX_CONTRACTS_PER_ORDER,

                        "maxOrdersPerMinute": MAX_ORDERS_PER_MINUTE

                    }

                })

                if state["authenticated"]:

                    await send_account_info(websocket)

                    print(f" 🔑 AUTH OK de {peer} — ponte {'ARMADA (entradas liberadas)' if state['armed'] else 'EM SEGURO (sem entradas)'}", flush=True)

                    await send_today_session_backfill(websocket, SYMBOL)

                else:

                    print(f" ⛔ AUTH RECUSADO de {peer} — token inválido.", flush=True)

                    await websocket.close(code=4001, reason="token invalido")

                continue



            if action in ("ARM", "DISARM"):

                if REQUIRE_AUTH and not state["authenticated"]:

                    continue

                state["armed"] = action == "ARM"

                await send_json(websocket, {"type": "ARM_RESULT", "data": {"armed": state["armed"]}})

                print(f" {'🟢 PONTE ARMADA: ordens de entrada liberadas' if state['armed'] else '🔒 PONTE EM SEGURO: nenhuma entrada nova'} — {peer}", flush=True)

                continue



            if action == "GET_MT5_EQUITY":

                limit = int(data.get("limit") or 1000)

                days = int(data.get("days") or 30)

                await send_mt5_equity_data(websocket, limit=limit, days=days)

                continue



            if action == "SET_BOX_POINTS":
                new_box_pts = float(data.get("boxPoints") or 0)
                if new_box_pts > 0:
                    BOX_POINTS = new_box_pts
                    if RENKO_ENGINE:
                        RENKO_ENGINE.box_points = BOX_POINTS
                    print(f" 📏 Escala Renko alterada para {BOX_POINTS} pts ({SYMBOL})", flush=True)
                continue

            if action == "GET_BACKFILL":
                await send_today_session_backfill(websocket, SYMBOL)
                continue



            if action in ("SELECT_ASSET", "SELECT_SYMBOL"):

# global declarations placed at top of ws_handler

                new_asset_id = str(data.get("assetId") or "").upper()

                new_sym = str(data.get("symbol") or "")

                

                if new_asset_id in SUPPORTED_ASSETS:

                    spec = SUPPORTED_ASSETS[new_asset_id]

                    SYMBOL = spec["symbol"]

                    ASSET_LABEL = spec["label"]

                    ASSET_DECIMALS = spec["decimals"]

                    ASSET_TICK_SIZE = spec["tick_size"]

                    ASSET_POINT_VALUE = spec["point_value"]

                    BOX_POINTS = spec["box_points"]

                elif new_sym:

                    SYMBOL = new_sym



                with MT5_LOCK:
                    mt5.symbol_select(SYMBOL, True)
                    ref_new = mt5.symbol_info_tick(SYMBOL)

                RENKO_ENGINE = RenkoFlowEngine(box_points=BOX_POINTS)
                if ref_new and (ref_new.last > 0 or ref_new.bid > 0):
                    p0 = float(ref_new.last if ref_new.last > 0 else ref_new.bid)
                    LAST_TICK_TIMES[SYMBOL] = int(ref_new.time_msc)
                    RENKO_ENGINE.init_engine(p0, LAST_TICK_TIMES[SYMBOL] + MT5_BRT_OFFSET_MSC)
                    print(f" 🎯 Renko reancorado para {SYMBOL} em {p0} pts (Box {BOX_POINTS} pts)", flush=True)
                else:
                    rates = mt5.copy_rates_from_pos(SYMBOL, mt5.TIMEFRAME_M1, 0, 1)
                    if rates is not None and len(rates) > 0:
                        p0 = float(rates[-1]["close"])
                        t0 = (int(rates[-1]["time"]) + MT5_BRT_OFFSET_SEC) * 1000
                        RENKO_ENGINE.init_engine(p0, t0)
                        print(f" 🎯 Renko reancorado via M1 para {SYMBOL} em {p0} pts (Box {BOX_POINTS} pts)", flush=True)

                if ORDER_MANAGER:
                    ORDER_MANAGER.symbol = SYMBOL

                LAST_BACKFILL_CACHE.pop(SYMBOL, None)
                LAST_BACKFILL_PAYLOAD = None
                print(f" 🔄 Ativo alterado para {SYMBOL} ({ASSET_LABEL})", flush=True)
                await send_account_info(websocket)
                await send_today_session_backfill(websocket, SYMBOL)
                continue



            if action == "RUN_BACKTEST":

                target_date = str(data.get("source") or data.get("date") or datetime.now().strftime("%Y-%m-%d"))

                renko_r = int(data.get("renkoR") or 10)

                strat = str(data.get("strategy") or "PYRAMID")

                req_symbol = str(data.get("symbol") or SYMBOL)

                print(f" 🧪 Executando BACKTEST SOLICITADO VIA WEB: {target_date} ({renko_r}R) em {req_symbol}...", flush=True)

                

                # Executa o backtest em thread para nao travar o loop de ticks

                import backtest_ticks_reais

                res = await asyncio.to_thread(backtest_ticks_reais.run_backtest_date, target_date, req_symbol, renko_r, strat)

                await send_json(websocket, {

                    "type": "BACKTEST_RESULT",

                    "status": "DONE" if res and not res.get("error") else "ERROR",

                    "data": res,

                    "error": res.get("error") if res else "Falha no processamento"

                })

                continue



            if action == "LIST_PREGOES":

                req_symbol = str(data.get("symbol") or SYMBOL)

                import backtest_ticks_reais

                pregoes = await asyncio.to_thread(backtest_ticks_reais.list_available_pregoes, req_symbol, 35)

                await send_json(websocket, {

                    "type": "PREGOES_LIST",

                    "data": pregoes

                })

                continue



            if action == "REQUEST_HISTORY":

                if REQUIRE_AUTH and not state["authenticated"]:

                    continue

                await handle_request_history(

                    websocket,

                    str(data.get("reqId") or ""),

                    str(data.get("symbol") or SYMBOL),

                    data.get("days") or 1

                )

                continue



            if action in TRADE_ACTIONS:

                allowed, reason = check_trade_allowed(state, data, action)

                if not allowed:

                    print(f" ⛔ ORDEM REJEITADA de {peer} ({action}): {reason}", flush=True)

                    await send_json(websocket, {

                        "type": "RISK_REJECT",

                        "data": {

                            "action": action,

                            "reason": reason,

                            "comment": data.get("comment", "")

                        }

                    })

                    continue

                if action == "ORDER_SEND":

                    order_magic = data.get("magic") or None

                    if data.get("isLimit"):

                        ORDER_MANAGER.place_websocket_limit_order(

                            data.get("type", "BUY"),

                            float(data.get("limitPrice") or 0),

                            data.get("comment", "WEB_LIMIT"),

                            data.get("contracts", 1),

                            data.get("sl", 0) or 0,

                            data.get("tp", 0) or 0,

                            magic=order_magic

                        )

                    else:

                        ORDER_MANAGER.execute_market_order(

                            data.get("type", "BUY"),

                            comment=data.get("comment", "WEB_ORDER"),

                            volume=data.get("contracts", 1),

                            sl_points=data.get("sl", 0) or 0,

                            tp_points=data.get("tp", 0) or 0,

                            magic=order_magic

                        )

                elif action == "ORDER_PARTIAL_CLOSE":

                    ORDER_MANAGER.close_partial_position(

                        data.get("ticket"), data.get("partialVolume"), data.get("newSL"),

                        magic=data.get("robotMagic") or None

                    )

                elif action == "ORDER_MODIFY_SL":

                    ORDER_MANAGER.modify_stop_loss(

                        data.get("ticket"), data.get("newSL"),

                        magic=data.get("robotMagic") or None

                    )

                elif action == "CLOSE_POSITIONS":

                    ORDER_MANAGER.close_all_positions(

                        data.get("type"),

                        magic=data.get("robotMagic") if data.get("robotMagic") else None

                    )

    except websockets.exceptions.ConnectionClosed:

        pass

    finally:

        CONNECTED_CLIENTS.discard(websocket)

        CLIENT_STATES.pop(websocket, None)





async def broadcast_to_web(msg_dict):

    if not CONNECTED_CLIENTS:

        return

    msg_str = json.dumps(msg_dict)

    disconnected = set()

    for client in list(CONNECTED_CLIENTS):

        state = CLIENT_STATES.get(client)

        if REQUIRE_AUTH and (state is None or not state["authenticated"]):

            continue

        try:

            await client.send(msg_str)

        except Exception:

            disconnected.add(client)

    for d in disconnected:

        CONNECTED_CLIENTS.discard(d)

        CLIENT_STATES.pop(d, None)





def _field(row, name, default):

    try:

        value = row[name]

    except Exception:

        return default

    return default if value is None else value





def _tick_price(raw):

    last_p = float(_field(raw, "last", 0) or 0)

    if last_p > 0:

        return round(last_p, ASSET_DECIMALS)

    bid_p = float(_field(raw, "bid", 0) or 0)

    if bid_p > 0:

        return round(bid_p, ASSET_DECIMALS)

    ask_p = float(_field(raw, "ask", 0) or 0)

    return round(ask_p, ASSET_DECIMALS)





def _history_tick_record(raw, seq):

    raw_msc = int(_field(raw, "time_msc", 0) or 0)

    time_msc = raw_msc + MT5_BRT_OFFSET_MSC

    flags = int(_field(raw, "flags", 0) or 0)

    if flags & mt5.TICK_FLAG_BUY:

        aggressor = "BUY"

    elif flags & mt5.TICK_FLAG_SELL:

        aggressor = "SELL"

    else:

        aggressor = "CROSS"

    vol = int(_field(raw, "volume", 0) or _field(raw, "volume_real", 0) or 0)

    return {

        "id": f"mt5-h-{time_msc}-{seq}",

        "timestamp": time_msc,

        "timeStr": datetime.fromtimestamp(time_msc / 1000).strftime('%H:%M:%S.%f')[:-3],

        "price": _tick_price(raw),

        "volume": vol,

        "aggressor": aggressor,

    }





async def handle_request_history(websocket, req_id, symbol, days):

    """Histórico real para Replay/Coletor via barras M1 do MT5 (rápido e com volume real da B3)."""

    try:

        days = max(1, min(HISTORY_MAX_DAYS, int(days or 1)))

    except (TypeError, ValueError):

        days = 1



    try:

        bars_needed = min(10000, days * 600)

        rates = await asyncio.to_thread(mt5.copy_rates_from_pos, symbol, mt5.TIMEFRAME_M1, 0, bars_needed)

    except Exception as exc:

        await send_json(websocket, {

            "type": "HISTORY_ERROR",

            "data": {"reqId": req_id, "reason": f"mt5.copy_rates_from_pos falhou: {exc}"}

        })

        return



    if rates is None or len(rates) == 0:

        await send_json(websocket, {

            "type": "HISTORY_ERROR",

            "data": {"reqId": req_id, "reason": f"Zero barras de '{symbol}' nos últimos {days} dia(s)."}

        })

        return



    ticks = []

    seq = 0

    for r in rates:

        base_msc = (int(r["time"]) + MT5_BRT_OFFSET_SEC) * 1000

        o = round(float(r["open"]), ASSET_DECIMALS)

        h = round(float(r["high"]), ASSET_DECIMALS)

        l = round(float(r["low"]), ASSET_DECIMALS)

        c = round(float(r["close"]), ASSET_DECIMALS)

        vol = max(4, int(r["tick_volume"] or 4))

        v_step = max(1, vol // 4)

        is_bull = c >= o

        steps = [

            (o, v_step, "BUY" if is_bull else "SELL", 0),

            (l if is_bull else h, v_step, "SELL" if is_bull else "BUY", 15000),

            (h if is_bull else l, v_step, "BUY" if is_bull else "SELL", 35000),

            (c, max(1, vol - 3 * v_step), "BUY" if is_bull else "SELL", 55000),

        ]

        for p, v, agg, dt in steps:

            ts = base_msc + dt

            ticks.append({

                "id": f"mt5-h-{ts}-{seq}",

                "timestamp": ts,

                "timeStr": datetime.fromtimestamp(ts / 1000).strftime('%H:%M:%S.%f')[:-3],

                "price": p,

                "volume": v,

                "aggressor": agg,

            })

            seq += 1



    total = len(ticks)

    chunks = 0

    for start in range(0, total, HISTORY_CHUNK_TICKS):

        await send_json(websocket, {

            "type": "HISTORY_CHUNK",

            "data": {

                "reqId": req_id,

                "index": chunks,

                "volumeSource": "M1_RATE",

                "ticks": ticks[start:start + HISTORY_CHUNK_TICKS]

            }

        })

        chunks += 1



    await send_json(websocket, {

        "type": "HISTORY_DONE",

        "data": {

            "reqId": req_id,

            "count": total,

            "chunks": chunks,

            "days": days,

            "symbol": symbol,

            "volumeSource": "M1_RATE"

        }

    })

    print(f"📜 HISTÓRICO enviado a {get_peer_ip(websocket)}: {total} ticks de '{symbol}' ({days} dia(s)) em {chunks} chunk(s).", flush=True)





STREAM_SYMBOLS = ["WINZ26", "WDOZ26", "BITX26"]
LAST_TICK_TIMES = {s: 0 for s in STREAM_SYMBOLS}

async def mt5_stream_loop():
    global LAST_TICK_TIMES, RENKO_ENGINE, ENGINES, ORDER_MANAGERS
    for s in STREAM_SYMBOLS:
        with MT5_LOCK:
            mt5.symbol_select(s, True)
            ref_i = mt5.symbol_info_tick(s)
            if ref_i:
                LAST_TICK_TIMES[s] = int(ref_i.time_msc)
                eng = get_or_create_engine(s)
                p0 = float(ref_i.last if ref_i.last > 0 else ref_i.bid)
                if p0 > 0:
                    eng.init_engine(p0, LAST_TICK_TIMES[s] + MT5_BRT_OFFSET_MSC)
                    print(f" 📡 Times & Trades ao vivo em '{s}' ativo a partir de {p0:.1f} pts...", flush=True)

    while True:
        try:
            for s in STREAM_SYMBOLS:
                with MT5_LOCK:
                    ref = mt5.symbol_info_tick(s)
                if not ref:
                    continue

                server_time_sec = int(ref.time)
                with MT5_LOCK:
                    ticks = mt5.copy_ticks_from(s, server_time_sec - 3, 100, mt5.COPY_TICKS_ALL)

                if ticks is not None and len(ticks) > 0:
                    eng = get_or_create_engine(s)
                    mgr = get_or_create_order_manager(s)
                    for tick in ticks:
                        raw_msc = int(tick['time_msc'])
                        if raw_msc <= LAST_TICK_TIMES.get(s, 0):
                            continue
                        LAST_TICK_TIMES[s] = raw_msc

                        price = _tick_price(tick)
                        if price <= 0:
                            continue
                        volume = int(_field(tick, "volume", 0) or _field(tick, "volume_real", 0) or 1)
                        flags = int(tick['flags'])
                        aggressor = "BUY" if (flags & mt5.TICK_FLAG_BUY) else ("SELL" if (flags & mt5.TICK_FLAG_SELL) else "CROSS")
                        ts_msc = raw_msc + MT5_BRT_OFFSET_MSC

                        # Transmissão do TICK independente para a fita de Times & Trades daquele ativo
                        await broadcast_to_web({
                            "type": "TICK",
                            "symbol": s,
                            "data": {
                                "id": f"mt5-{s}-{ts_msc}",
                                "symbol": s,
                                "timestamp": ts_msc,
                                "timeStr": datetime.fromtimestamp(ts_msc / 1000).strftime('%H:%M:%S.%f')[:-3],
                                "price": price,
                                "volume": volume,
                                "aggressor": aggressor
                            }
                        })

                        # O motor Renko de CADA ativo processa o tick concorrentemente
                        new_box, signal, reason = eng.process_tick(price, volume, aggressor, ts_msc)
                        if new_box:
                            print(f"[{datetime.fromtimestamp(ts_msc/1000).strftime('%H:%M:%S')}] Box {s} #{new_box['index']}: {new_box['direction']} | {new_box['open']} -> {new_box['close']}", flush=True)
                            await broadcast_to_web({"type": "BOX_CLOSED", "symbol": s, "data": new_box})
                            mgr.check_and_clean_expired_pending(new_box["index"])
                            mgr.watch_closed_pyramids()

                            if signal:
                                print(f" ⚡ SINAL GERADO [{s}]: {signal} ({reason})", flush=True)
                                await broadcast_to_web({
                                    "type": "SIGNAL_GENERATED",
                                    "symbol": s,
                                    "data": {
                                        "signal": signal,
                                        "reason": reason,
                                        "boxIndex": new_box["index"],
                                        "price": new_box["close"],
                                        "timestamp": ts_msc
                                    }
                                })
                                # Se a ponte estiver armada em qualquer cliente, executa com o magic number do ativo
                                if any(client_state(c).get("armed", False) for c in CONNECTED_CLIENTS):
                                    mgr.execute_pyramid_confluence(signal, new_box)

            await asyncio.sleep(0.01)
        except Exception as exc:
            print(f"[AVISO STREAM] {exc}", flush=True)
            await asyncio.sleep(0.05)

async def mt5_equity_broadcaster_loop():

    while True:

        await asyncio.sleep(2.0)

        if not CONNECTED_CLIENTS:

            continue

        try:

            with MT5_LOCK:

                acc = mt5.account_info()

            if not acc:

                continue

            positions = await asyncio.to_thread(fetch_mt5_positions)

            await broadcast_to_web({

                "type": "MT5_EQUITY_UPDATE",

                "data": {

                    "balance": acc.balance,

                    "equity": acc.equity,

                    "floatingProfit": acc.profit,

                    "margin": acc.margin,

                    "marginFree": acc.margin_free,

                    "positions": positions

                }

            })

        except Exception:

            pass



async def main():

    global ORDER_MANAGER, RENKO_ENGINE

    if not mt5.initialize():

        print(f"[ERRO] Falha ao iniciar MT5: {mt5.last_error()}", flush=True)

        sys.exit(1)



    mt5.symbol_select(SYMBOL, True)

    RENKO_ENGINE = RenkoFlowEngine(box_points=BOX_POINTS)

    ORDER_MANAGER = MT5OrderManager(symbol=SYMBOL, contracts=MAIN_CONTRACTS, magic_number=MAGIC_NUMBER)



    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)

    print(f" Servidor WebSocket ativo em toda a rede local na porta {WS_PORT} — pronto para conectar!", flush=True)

    try:

        await asyncio.gather(server.wait_closed(), mt5_stream_loop(), mt5_equity_broadcaster_loop())

    except KeyboardInterrupt:

        pass

    finally:

        mt5.shutdown()





if __name__ == "__main__":

    asyncio.run(main())

