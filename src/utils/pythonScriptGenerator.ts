import { AutomationConfig } from '../types/trading';

export function generatePythonMT5Script(config: AutomationConfig): string {
  const isPyramidMode = config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE';

  return `"""
========================================================================================
ROBÔ QUANTITATIVO MT5: ${isPyramidMode ? 'PIRÂMIDE & CONFLUÊNCIA DE FLUXO RENKO 10R (TP 50p + SURFE)' : 'RENKO 10R COM ENTRADA NO RETESTE / PULLBACK'}
========================================================================================
Ativo Padrão: ${config.symbol} (Mini-Índice B3 / WIN$)
Estratégia: ${isPyramidMode ? 'PIRÂMIDE EM CADA BOX VERDE/VERMELHO (TP 50p) + ORDEM MÃE ABERTA ATÉ INVERSÃO' : 'PULLBACK / RETESTE DA ABERTURA DO BOX'}
Modo de Conta: ${config.accountMode}

Regras da Estratégia de Pirâmide & Confluência:
  1. Box Verde Fecha -> COMPRA. Se for o primeiro box, abre ORDEM MÃE (sem TP/SL fixos, surfa a tendência).
  2. Próximos Boxes Verdes -> abre ordens de PIRÂMIDE com TP de +50 pontos cada.
  3. Box Vermelho Fecha -> INVERSÃO TOTAL: encerra imediatamente a ordem mãe e todas as ordens de pirâmide abertas.
     Em seguida, abre a ORDEM MÃE DE VENDA e empilha vendas nos próximos boxes vermelhos.
  4. Nenhuma ordem tem Stop Loss em pontos fixo: o stop é 100% dinâmico pela INVERSÃO DO FLUXO/MERCADO!

Instalação:
  pip install MetaTrader5 websockets
========================================================================================
"""

import sys
import time
import json
import asyncio
from datetime import datetime, timezone
import MetaTrader5 as mt5
import websockets

# ==============================================================================
# CONFIGURAÇÕES DA ESTRATÉGIA E MODO DE OPERAÇÃO
# ==============================================================================
SYMBOL = "${config.symbol}"                  # Código do ativo (ex: WIN$N, WING25)
ACCOUNT_MODE = "${config.accountMode}"        # "HEDGE" ou "NETTING"
STRATEGY_MODE = "${config.strategyMode || 'PYRAMID_FLOW_CONFLUENCE'}"
MAX_POSITIONS = ${config.maxSimultaneousPositions || 10}

# CONFIGURAÇÕES DA PIRÂMIDE & CONFLUÊNCIA
PYRAMID_TP_POINTS = ${config.pyramidTpPoints || 50}          # TP de cada ordem da pirâmide (+50 pts)
PYRAMID_CONTRACTS = ${config.pyramidContracts || 1}          # Lote das ordens de pirâmide
MAIN_CONTRACTS = ${config.contracts || 1}                    # Lote da ordem mãe de surfe
HOLD_MAIN_UNTIL_FLIP = ${config.holdMainUntilFlip !== false ? 'True' : 'False'}
CLOSE_ALL_ON_FLIP = ${config.closeAllOnFlowFlip !== false ? 'True' : 'False'}

# TIPO DE ENTRADA: "PULLBACK_ENTRY" ou "MARKET_ON_CLOSE"
ENTRY_TRIGGER_TYPE = "${config.entryTriggerType || 'MARKET_ON_CLOSE'}"
PULLBACK_TARGET = "${config.pullbackTarget || 'BOX_OPEN'}"
PULLBACK_CUSTOM_POINTS = ${config.pullbackCustomPoints || 25}
PULLBACK_MAX_BOXES_WAIT = ${config.pullbackMaxBoxesWait || 2}

BOX_POINTS = ${config.boxPoints || 50}                 # Tamanho do box: 50 pontos (10R no Mini-Índice)
MIN_DELTA_THRESHOLD = ${config.minDeltaThreshold || 0}   # Delta mínimo de agressão
REQUIRE_CVD_EXTREME = ${config.requireCvdNewExtreme ? 'True' : 'False'}

STOP_LOSS_POINTS = ${config.stopLossPoints || 0}
TAKE_PROFIT_POINTS = ${config.takeProfitPoints || 0}

# REALIZAÇÃO PARCIAL & BREAKEVEN (Apenas se configurado fora da pirâmide)
ENABLE_PARTIAL_EXIT = ${config.enablePartialExit ? 'True' : 'False'}
PARTIAL_POINTS = ${config.partialPoints || 50}
PARTIAL_CONTRACTS = ${config.partialContracts || 1}
MOVE_SL_BREAKEVEN_ON_PARTIAL = ${config.moveStopToBreakevenOnPartial ? 'True' : 'False'}
BREAKEVEN_OFFSET_POINTS = ${config.breakevenOffsetPoints || 5}

# TRAILING STOP DINÂMICO
TRAILING_STOP = ${config.trailingStop ? 'True' : 'False'}
TRAILING_ACTIVATION_POINTS = ${config.trailingActivationPoints || 60}
TRAILING_DISTANCE_POINTS = ${config.trailingDistancePoints || 50}

MAX_DAILY_LOSS = ${config.maxDailyLoss}
MAX_DAILY_PROFIT = ${config.maxDailyProfit}
MAX_DAILY_TRADES = ${config.maxDailyTrades || 10}

# IDENTIFICAÇÃO DO EA DETERMINADA PELO OPERADOR
MAGIC_NUMBER = ${config.magicNumber || 102030}
ORDER_COMMENT = "${config.orderComment || 'Renko10R_Flow'}"

# JANELA DE HORÁRIOS CONFIGURADA PELO OPERADOR (DAY TRADE B3)
TRADING_HOURS_ENABLED = ${config.tradingHoursEnabled ? 'True' : 'False'}
START_TIME = "${config.tradingStartTime || '09:05'}"
STOP_ENTRIES_TIME = "${config.tradingStopEntriesTime || '17:00'}"
CLOSE_ALL_TIME = "${config.tradingCloseAllTime || '17:45'}"

WS_HOST = "${config.mt5Host || 'localhost'}"
WS_PORT = ${config.mt5Port || 8765}


# ==============================================================================
# MOTOR RENKO 10R E FLUXO ATEMPORAL
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
        print(f"[RENKO 10R] Inicializado em {base_price:.1f} pts")

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

        return None, ""


# ==============================================================================
# GERENCIADOR DE ORDENS: ENTRADA NO PULLBACK / LIMIT OU A MERCADO
# ==============================================================================
class MT5OrderManager:
    def __init__(self, symbol, contracts, magic_number):
        self.symbol = symbol
        self.contracts = float(contracts)
        self.magic_number = magic_number
        self.daily_pnl = 0.0
        self.pending_orders = [] # Armazena ordens de pullback pendentes

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
        """Calcula o preço de entrada no retorno/pullback do box"""
        box_open = box["open"]
        box_close = box["close"]

        if PULLBACK_TARGET == "BOX_OPEN":
            # Retorno de 100% do box (exatamente na abertura)
            return box_open
        elif PULLBACK_TARGET == "BOX_50_PCT":
            # Retorno de 50% do box (meio do caminho)
            return (box_open + box_close) / 2.0
        else:
            # Custom pontos
            pts = PULLBACK_CUSTOM_POINTS
            return (box_close - pts) if signal == "BUY" else (box_close + pts)

    def check_schedule(self):
        """Verifica horários operacionais definidos pelo operador"""
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
        """Envia ordem LIMITADA no MT5 aguardando o preço recuar para a entrada"""
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

        print(f"\\n========================================================")
        print(f"⏳ POSICIONANDO ORDEM {signal} NO PULLBACK (LIMITADA)")
        print(f"Ativo: {self.symbol} | Preço de Entrada: {limit_price:.1f} (Abertura: {box['open']:.1f})")
        print(f"Aguardando o preço VOLTAR para acionar a ordem!")
        print(f"Stop Loss: {sl_price:.1f} | Take Profit: {tp_price:.1f}")
        print(f"========================================================\\n")

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

    def check_and_clean_expired_pending(self, current_box_index):
        """Cancela ordens pendentes se o preço continuou andando sem voltar"""
        to_remove = []
        for p in self.pending_orders:
            if current_box_index - p["box_index"] >= PULLBACK_MAX_BOXES_WAIT:
                print(f"[EXPIRAÇÃO] Preço não voltou para testar a entrada (#{p['ticket']}). Cancelando...")
                req = {
                    "action": mt5.TRADE_ACTION_REMOVE,
                    "order": p["ticket"],
                    "magic": self.magic_number
                }
                mt5.order_send(req)
                to_remove.append(p)
        for r in to_remove:
            self.pending_orders.remove(r)

    def execute_market_order(self, order_type, comment="", volume=None, sl_points=None, tp_points=None):
        """Execução direta a mercado com suporte a TP/SL customizados (ex: Pirâmide ou Ordem Mãe)"""
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

        # Cálculo de SL
        sl_val = sl_points if sl_points is not None else STOP_LOSS_POINTS
        if sl_val > 0:
            sl_price = entry_price - (sl_val * point) if is_buy else entry_price + (sl_val * point)
        else:
            sl_price = 0.0

        # Cálculo de TP
        tp_val = tp_points if tp_points is not None else TAKE_PROFIT_POINTS
        if tp_val > 0:
            tp_price = entry_price + (tp_val * point) if is_buy else entry_price - (tp_val * point)
        else:
            tp_price = 0.0

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
            "magic": self.magic_number,
            "comment": order_tag,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": self.get_filling_mode(),
        }
        res = mt5.order_send(request)
        if res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"✅ ORDEM EXECUTADA: {order_type} {use_volume} ctros @ {entry_price:.1f} | SL: {sl_price:.1f} | TP: {tp_price:.1f} | Ticket #{res.order}")
            return True, res.order
        else:
            print(f"[ERRO MT5] RetCode={res.retcode}, Desc={res.comment}")
        return False, 0

    def execute_pyramid_confluence(self, signal, box):
        """
        Executa a Estratégia de Pirâmide com Confluência 10R:
        - Na virada de fluxo: zera todas as posições opostas e abre ORDEM MÃE (surfe sem TP fixo).
        - Em cada box consecutivo da mesma cor: abre PIRÂMIDE com TP de +50 pontos.
        - Stop Loss: Sem stops em pontos, tudo é encerrado na inversão do mercado.
        """
        positions = mt5.positions_get(symbol=self.symbol)
        active_positions = list(positions) if positions else []

        current_dir = signal # "BUY" ou "SELL"
        has_opposite = False

        for pos in active_positions:
            is_pos_buy = pos.type == mt5.ORDER_TYPE_BUY
            if (current_dir == "BUY" and not is_pos_buy) or (current_dir == "SELL" and is_pos_buy):
                has_opposite = True
                break

        # 1. Se virou o mercado/fluxo, encerra imediatamente todas as posições abertas
        if has_opposite:
            print(f"\\n🔄 [INVERSÃO DE FLUXO DETECTADA] Zerando todas as posições abertas para virar para {current_dir}!")
            self.close_all_positions()
            time.sleep(0.05)
            active_positions = []

        # 2. Verifica se já temos uma ordem mãe aberta nesta direção
        has_main_order = False
        pyramid_count = 0
        for pos in active_positions:
            if "MAE" in pos.comment:
                has_main_order = True
            elif "PIR" in pos.comment:
                pyramid_count += 1

        if not has_main_order:
            # Abre a ORDEM MÃE (SURFE)
            print(f"🟢 [ABRINDO ORDEM MÃE] {current_dir} {MAIN_CONTRACTS} ctro(s) no Box #{box['index']} | Sem TP fixo | Stop por inversão")
            success, ticket = self.execute_market_order(
                order_type=current_dir,
                comment=f"MAE_{box['index']}",
                volume=MAIN_CONTRACTS,
                sl_points=0,
                tp_points=0
            )
            return success, ticket, "MAIN"
        else:
            # Já temos ordem mãe: abre ordem de PIRÂMIDE com TP de +50 pontos
            pyramid_num = pyramid_count + 1
            print(f"🔺 [ABRINDO PIRÂMIDE #{pyramid_num}] {current_dir} {PYRAMID_CONTRACTS} ctro(s) no Box #{box['index']} | TP: +{PYRAMID_TP_POINTS} pts")
            success, ticket = self.execute_market_order(
                order_type=current_dir,
                comment=f"PIR_{pyramid_num}_{box['index']}",
                volume=PYRAMID_CONTRACTS,
                sl_points=0,
                tp_points=PYRAMID_TP_POINTS
            )
            return success, ticket, "PYRAMID"

    def close_partial_position(self, ticket, partial_volume, new_sl=None):
        """Executa saída parcial de volume de uma posição Hedge específica"""
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            # Tenta buscar por símbolo se ticket não for direto
            positions = mt5.positions_get(symbol=self.symbol)
        if not positions:
            print(f"[PARCIAL] Nenhuma posição aberta encontrada para ticket #{ticket}")
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
            "magic": self.magic_number,
            "comment": f"Parcial #{pos.ticket}",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": self.get_filling_mode(),
        }

        res = mt5.order_send(request)
        if res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"🎯 [PARCIAL REALIZADA] {partial_volume} contrato(s) encerrado(s) na posição #{pos.ticket}!")
            if new_sl is not None:
                self.modify_stop_loss(pos.ticket, new_sl)
            return True
        else:
            print(f"[ERRO PARCIAL] RetCode={res.retcode}, Desc={res.comment}")
            return False

    def modify_stop_loss(self, ticket, new_sl):
        """Move o Stop Loss (Breakeven ou Trailing Stop) de uma posição"""
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
            "magic": self.magic_number
        }
        res = mt5.order_send(request)
        if res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"🛡️ [BREAKEVEN/TRAILING] Stop Loss movido para {new_sl:.1f} na posição #{pos.ticket}!")
            return True
        return False

    def close_all_positions(self):
        """Encerra todas as posições abertas a mercado"""
        positions = mt5.positions_get(symbol=self.symbol)
        if not positions:
            return True
        for pos in positions:
            close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
            tick = mt5.symbol_info_tick(self.symbol)
            price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask
            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": pos.ticket,
                "symbol": self.symbol,
                "volume": pos.volume,
                "type": close_type,
                "price": price,
                "deviation": 20,
                "magic": self.magic_number,
                "comment": "Zerar Terminal Web",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": self.get_filling_mode(),
            }
            mt5.order_send(req)
        print("🛑 Todas as posições zeradas a mercado.")
        return True


# ==============================================================================
# WEBSOCKET & LOOP PRINCIPAL
# ==============================================================================
CONNECTED_CLIENTS = set()
ORDER_MANAGER = None
RENKO_ENGINE = None

async def ws_handler(websocket):
    CONNECTED_CLIENTS.add(websocket)
    acc = mt5.account_info()
    init_msg = {
        "type": "ACCOUNT_INFO",
        "data": {
            "login": acc.login if acc else 0,
            "broker": acc.company if acc else "MetaTrader 5",
            "balance": acc.balance if acc else 0.0,
            "entryTriggerType": ENTRY_TRIGGER_TYPE,
            "pullbackTarget": PULLBACK_TARGET,
            "partialExit": ENABLE_PARTIAL_EXIT,
            "trailingStop": TRAILING_STOP
        }
    }
    await websocket.send(json.dumps(init_msg))

    try:
        async for message in websocket:
            data = json.loads(message)
            action = data.get("action")
            if action == "ORDER_SEND":
                ORDER_MANAGER.execute_market_order(data.get("type", "BUY"))
            elif action == "ORDER_PARTIAL_CLOSE":
                ORDER_MANAGER.close_partial_position(data.get("ticket"), data.get("partialVolume"), data.get("newSL"))
            elif action == "ORDER_MODIFY_SL":
                ORDER_MANAGER.modify_stop_loss(data.get("ticket"), data.get("newSL"))
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
    print(f" Monitorando Times & Trades em '{SYMBOL}'...")
    print(f" Modo de Entrada: {'RETESTE NO PULLBACK DA ABERTURA' if ENTRY_TRIGGER_TYPE == 'PULLBACK_ENTRY' else 'A MERCADO NO FECHAMENTO'}\\n")

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
                    print(f"[{datetime.fromtimestamp(tick_msc/1000).strftime('%H:%M:%S')}] Box 10R #{new_box['index']}: {new_box['direction']} | Abertura: {new_box['open']} -> Fech: {new_box['close']}")
                    await broadcast_to_web({"type": "BOX_CLOSED", "data": new_box})

                    # Limpa ordens de pullback antigas que expiraram
                    ORDER_MANAGER.check_and_clean_expired_pending(new_box["index"])

                    # GATILHO DE CONVERGÊNCIA:
                    if signal:
                        if STRATEGY_MODE == "PYRAMID_FLOW_CONFLUENCE":
                            # ESTRATÉGIA PIRÂMIDE (TP 50p) + ORDEM MÃE SURFE ATÉ INVERSÃO
                            success, ticket, role = ORDER_MANAGER.execute_pyramid_confluence(signal, new_box)
                            if success:
                                await broadcast_to_web({
                                    "type": "PYRAMID_ORDER_PLACED",
                                    "data": {
                                        "ticket": ticket,
                                        "role": role,
                                        "signal": signal,
                                        "boxIndex": new_box["index"],
                                        "reason": f"Ordem {role} ({signal}) executada no fechamento do box #{new_box['index']}"
                                    }
                                })
                        elif ENTRY_TRIGGER_TYPE == "PULLBACK_ENTRY":
                            # POSICIONA ORDEM LIMITADA NA ENTRADA / ABERTURA DO BOX
                            success, ticket, limit_price = ORDER_MANAGER.place_pullback_limit_order(signal, new_box, reason)
                            if success:
                                await broadcast_to_web({
                                    "type": "PULLBACK_LIMIT_PLACED",
                                    "data": {
                                        "ticket": ticket,
                                        "signal": signal,
                                        "limitPrice": limit_price,
                                        "boxIndex": new_box["index"],
                                        "reason": f"Ordem Limitada de {signal} no Reteste da Abertura ({limit_price:.1f} pts)"
                                    }
                                })
                        else:
                            # A MERCADO NO FECHAMENTO
                            ORDER_MANAGER.execute_market_order(signal, reason)

        await asyncio.sleep(0.01)

async def main():
    global ORDER_MANAGER, RENKO_ENGINE
    if not mt5.initialize():
        print(f"[ERRO] Falha ao iniciar MT5: {mt5.last_error()}")
        sys.exit(1)

    RENKO_ENGINE = RenkoFlowEngine(box_points=BOX_POINTS)
    ORDER_MANAGER = MT5OrderManager(symbol=SYMBOL, contracts=CONTRACTS, magic_number=MAGIC_NUMBER)

    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    print(f" Servidor WebSocket ativo em ws://{WS_HOST}:{WS_PORT}")
    try:
        await asyncio.gather(server.wait_closed(), mt5_stream_loop())
    except KeyboardInterrupt:
        pass
    finally:
        mt5.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
`;
}
