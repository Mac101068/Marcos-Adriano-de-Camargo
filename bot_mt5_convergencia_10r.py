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

# ESTRATÉGIA PIRÂMIDE & CONFLUÊNCIA
BOX_POINTS = 50                 # 10R = 50 pontos no Mini-Índice
PYRAMID_TP_POINTS = 50          # TP de cada ordem da pirâmide (+50 pts)
PYRAMID_CONTRACTS = 1.0         # Lote das ordens de pirâmide
MAIN_CONTRACTS = 1.0            # Lote da ordem mãe de surfe
MAX_POSITIONS = 5               # Limite máximo de ordens simultâneas
MIN_DELTA_THRESHOLD = 150.0     # Delta mínimo institucional

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
# MOTOR RENKO 10R E FLUXO ATEMPORAL (DELTA E CVD)
# ==============================================================================
class RenkoFlowEngine:
    def __init__(self, box_points=50):
        self.box_points = box_points
        self.boxes = []
        self.current_box = None
        self.cvd = 0.0

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
        print(f"[RENKO 10R] Inicializado no preço base: {base_price:.0f} pts")

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

        if direction == "UP" and delta >= MIN_DELTA_THRESHOLD:
            reason = f"Convergência COMPRA: Box 10R Alta + Delta +{delta} ctros"
            return "BUY", reason
        elif direction == "DOWN" and delta <= -MIN_DELTA_THRESHOLD:
            reason = f"Convergência VENDA: Box 10R Baixa + Delta {delta} ctros"
            return "SELL", reason

        # Em ausência de filtro extremo, o fechamento do box conduz a direção
        return direction, f"Fechamento Box 10R {direction} (Delta: {delta})"


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
        if sym_info.filling_mode & mt5.SYMBOL_FILLING_IOC:
            return mt5.ORDER_FILLING_IOC
        elif sym_info.filling_mode & mt5.SYMBOL_FILLING_FOK:
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
        is_buy = order_type == "BUY"
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
            "deviation": 20,
            "magic": self.magic_number,
            "comment": order_tag,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": self.get_filling_mode(),
        }

        res = mt5.order_send(request)
        if res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"✅ ORDEM EXECUTADA: {order_type} {use_volume} ctros @ {entry_price:.0f} | SL: {sl_price:.0f} | TP: {tp_price:.0f} | Ticket #{res.order}")
            return True, res.order
        else:
            print(f"[ERRO MT5] RetCode={res.retcode}, Desc={res.comment}")
            return False, 0

    def execute_pyramid_confluence(self, signal, box):
        positions = mt5.positions_get(symbol=self.symbol)
        active_positions = [p for p in positions if p.magic == self.magic_number] if positions else []

        current_dir = signal # "BUY" ou "SELL"
        has_opposite = False

        for pos in active_positions:
            is_pos_buy = pos.type == mt5.ORDER_TYPE_BUY
            if (current_dir == "BUY" and not is_pos_buy) or (current_dir == "SELL" and is_pos_buy):
                has_opposite = True
                break

        # 1. Se o fluxo inverteu, liquida posições opostas imediatamente
        if has_opposite:
            print(f"\n🔄 [INVERSÃO DE FLUXO] Zerando posições anteriores para virar a mão para {current_dir}!")
            self.close_all_positions()
            time.sleep(0.05)
            active_positions = []

        # 2. Verifica se a Ordem Mãe já existe
        has_main_order = False
        pyramid_count = 0
        for pos in active_positions:
            if "MAE" in pos.comment:
                has_main_order = True
            elif "PIR" in pos.comment:
                pyramid_count += 1

        if not has_main_order:
            # Dispara Ordem Mãe de Surfe
            print(f"🟢 [ORDEM MÃE] Disparando {current_dir} ({MAIN_CONTRACTS} ct) no Box #{box['index']} | Surfe até inversão")
            success, ticket = self.execute_market_order(
                order_type=current_dir,
                comment=f"MAE_{box['index']}",
                volume=MAIN_CONTRACTS,
                sl_points=0,
                tp_points=0
            )
            return success, ticket, "MAIN"
        elif pyramid_count < MAX_POSITIONS:
            # Dispara Pirâmide com TP fixo de 50 pontos
            pyramid_num = pyramid_count + 1
            print(f"🔺 [PIRÂMIDE #{pyramid_num}] Disparando {current_dir} ({PYRAMID_CONTRACTS} ct) no Box #{box['index']} | Alvo +{PYRAMID_TP_POINTS} pts")
            success, ticket = self.execute_market_order(
                order_type=current_dir,
                comment=f"PIR_{pyramid_num}_{box['index']}",
                volume=PYRAMID_CONTRACTS,
                sl_points=75,
                tp_points=PYRAMID_TP_POINTS
            )
            return success, ticket, "PYRAMID"
        return False, 0, "NONE"

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


# ==============================================================================
# WEBSOCKET SERVER & STREAM EM TEMPO REAL
# ==============================================================================
async def ws_handler(websocket):
    CONNECTED_CLIENTS.add(websocket)
    acc = mt5.account_info()
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

    try:
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
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CONNECTED_CLIENTS.remove(websocket)

async def broadcast_to_web(msg_dict):
    if not CONNECTED_CLIENTS:
        return
    msg_str = json.dumps(msg_dict)
    disconnected = set()
    for client in CONNECTED_CLIENTS:
        try:
            await client.send(msg_str)
        except Exception:
            disconnected.add(client)
    for d in disconnected:
        CONNECTED_CLIENTS.discard(d)

async def mt5_stream_loop():
    last_tick_time_msc = 0
    print(f"📡 Monitorando Times & Trades em tempo real em '{SYMBOL}'...")

    while True:
        now = datetime.now(timezone.utc)
        ticks = mt5.copy_ticks_from(SYMBOL, now, 50, mt5.COPY_TICKS_TRADE)

        if ticks is not None and len(ticks) > 0:
            for tick in ticks:
                tick_msc = tick['time_msc']
                if tick_msc <= last_tick_time_msc:
                    continue
                last_tick_time_msc = tick_msc

                price = tick['price']
                volume = int(tick['volume'])
                flags = tick['flags']
                aggressor = "BUY" if (flags & mt5.TICK_FLAG_BUY) else ("SELL" if (flags & mt5.TICK_FLAG_SELL) else "CROSS")

                # Transmite tick ao Terminal Web
                await broadcast_to_web({
                    "type": "TICK",
                    "data": {
                        "id": f"mt5-{tick_msc}",
                        "timestamp": tick_msc,
                        "timeStr": datetime.fromtimestamp(tick_msc/1000).strftime('%H:%M:%S.%f')[:-3],
                        "price": price,
                        "volume": volume,
                        "aggressor": aggressor
                    }
                })

                new_box, signal, reason = RENKO_ENGINE.process_tick(price, volume, aggressor, tick_msc)

                if new_box:
                    print(f"[{datetime.fromtimestamp(tick_msc/1000).strftime('%H:%M:%S')}] Box 10R #{new_box['index']}: {new_box['direction']} | {new_box['open']:.0f} -> {new_box['close']:.0f} | Delta: {new_box['delta']}")
                    await broadcast_to_web({"type": "BOX_CLOSED", "data": new_box})

                    if signal:
                        success, ticket, role = ORDER_MANAGER.execute_pyramid_confluence(signal, new_box)
                        if success:
                            await broadcast_to_web({
                                "type": "ORDER_RESULT",
                                "ticket": ticket,
                                "role": role,
                                "orderType": signal,
                                "status": "DONE",
                            })

        await asyncio.sleep(0.01)

async def main():
    global ORDER_MANAGER, RENKO_ENGINE
    if not mt5.initialize():
        if not mt5.initialize(r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe"):
            print(f"[ERRO] Falha ao conectar ao MT5: {mt5.last_error()}")
            sys.exit(1)

    acc = mt5.account_info()
    print("=" * 65)
    print(f"🤖 ROBÔ FLUXO B3 CONECTADO AO METATRADER 5")
    print(f"Conta: {acc.login} | Servidor: {acc.server} | Nome: {acc.name}")
    print(f"Ativo Alvo: {SYMBOL} | Box Renko: 10R ({BOX_POINTS} pts)")
    print(f"Modo: Conta Demo/Simulador XP Investimentos")
    print("=" * 65)

    RENKO_ENGINE = RenkoFlowEngine(box_points=BOX_POINTS)
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
