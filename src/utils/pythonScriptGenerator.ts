import { AutomationConfig } from '../types/trading';
import { getBridgeToken } from './bridgeSecurity';
import { resolveAsset } from '../assets/assetRegistry';

export function generatePythonMT5Script(config: AutomationConfig): string {
  const isPyramidMode = config.strategyMode === 'PYRAMID_FLOW_CONFLUENCE';
  // Os números do contrato transmitido saem do registro de ativos (Fase 2): decimais para o
  // print, tick para a deduplicação do histórico e R$/ponto para os tetos em dinheiro. Sem o MT5
  // conectado o único caminho possível continuam sendo os ticks sintéticos do próprio app.
  const asset = resolveAsset(config.symbol, config.assetId);
  // O mesmo segredo que o app vai enviar no frame AUTH (criado e guardado no navegador)
  const bridgeToken = getBridgeToken();

  return `"""
========================================================================================
ROBÔ QUANTITATIVO MT5: ${isPyramidMode ? 'PIRÂMIDE & CONFLUÊNCIA DE FLUXO RENKO 10R (TP 50p + SURFE)' : 'RENKO 10R COM ENTRADA NO RETESTE / PULLBACK'}
========================================================================================
Ativo: ${config.symbol || asset.primarySymbol} (${asset.label})${asset.status === 'a_confirmar' ? ' — SPEC A CONFIRMAR NA CORRETORA' : ''}
Estratégia: ${isPyramidMode ? 'PIRÂMIDE EM CADA BOX VERDE/VERMELHO (TP 50p) + ORDEM MÃE ABERTA ATÉ INVERSÃO' : 'PULLBACK / RETESTE DA ABERTURA DO BOX'}
Modo de Conta: ${config.accountMode}

Regras da Estratégia de Pirâmide & Confluência:
  1. Box fecha -> COMPRA/SELL. Se for o primeiro box da perna, abre ORDEM MÃE (sem TP fixo, surfa a tendência).
  2. Próximos boxes da mesma cor -> abre ordens de PIRÂMIDE com TP de +${config.pyramidTpPoints || 50} pontos cada.
  3. Entrada configurável (PYRAMID_ENTRY_TYPE): "MARKET_ON_CLOSE" (a mercado no fechamento),
     "BOX_50_LIMIT" (limitada a 50% do box que fechou) ou "BOX_OPEN_LIMIT" (limitada na entrada/abertura do box).
  4. Stop da pirâmide é OPCIONAL (PYRAMID_SL_POINTS): em 0, a saída é só pela inversão do fluxo.
  5. MAIN_BREAKEVEN_ON_PYR_TP: a cada TP de pirâmide batido, o stop da ordem mãe sobe para a
     entrada + ${config.breakevenOffsetPoints || 5} pontos (offset das taxas da B3), travando o resultado da perna.
  6. Box na direção contrária -> INVERSÃO TOTAL: encerra a ordem mãe e todas as pirâmides abertas e
     já inicia a nova perna na direção contrária.

Instalação:
  pip install MetaTrader5 websockets

ARQUITETURA (2 máquinas na mesma rede Wi-Fi):
  1. Este script roda na máquina WINDOWS onde o terminal MT5 (XP B3) está instalado/logado.
  2. A ponte escuta em TODA a rede local (porta 8765), então o navegador de qualquer
     computador da rede pode conectar: no app, em Ajustes, use "MT5 Host" = IP do Windows
     (descubra com: ipconfig no cmd) e clique em "Conectar MT5".
  3. Na primeira execução, permita o acesso do Python no Firewall do Windows.
  4. SEGURANÇA DA PONTE (porta ${config.mt5Port || 8765}): esta ponte mexe na conta que já
     está logada no terminal, então ela NÃO entrega nada e NÃO aceita comando de ninguém
     até chegar o primeiro frame {"action": "AUTH", "token": ...} com o token abaixo.
     - Sem token correto: conexão fechada, nenhum tick e nenhum dado de conta vazado.
     - Robô DESLIGADO no app = ponte "EM SEGURO": recusa ordem de ENTRADA (saídas,
       parcial, stop e "zerar terminal" continuam liberados para você se proteger).
     - Tetos de risco: ${config.mt5MaxContractsPerOrder || 2} contrato(s) por ordem e
       ${config.mt5MaxOrdersPerMinute || 12} ordem(s) de entrada por minuto.
     - Toda tentativa recusada aparece no console com o IP de origem.
  5. HISTÓRICO REAL: o app pode pedir {"action": "REQUEST_HISTORY", "reqId", "symbol", "days"}
     (teto de 10 dias corridos por pedido) e recebe os ticks de mt5.copy_ticks_range em chunks
     HISTORY_CHUNK + HISTORY_DONE. A chamada bloqueante vai para uma thread, então o feed ao vivo
     NUNCA para enquanto o histórico desce.
     Para trocar o token: app > Ajustes > Segurança da Ponte > gerar novo, e baixe o
     script outra vez (app e este arquivo precisam estar com o MESMO token).
========================================================================================
"""

import sys
import time
import json
import secrets
import asyncio
from datetime import datetime, timezone, timedelta
import MetaTrader5 as mt5
import websockets

# ==============================================================================
# CONFIGURAÇÕES DA ESTRATÉGIA E MODO DE OPERAÇÃO
# ==============================================================================
SYMBOL = "${config.symbol || asset.primarySymbol}"                  # Código do ativo transmitido (ex: WIN$N, WDO$N)
ASSET_LABEL = "${asset.label}"
ASSET_DECIMALS = ${asset.decimals}                    # Casas decimais do preço deste contrato
ASSET_TICK_SIZE = ${asset.tickSize}                   # Variação mínima em pontos
ASSET_POINT_VALUE = ${asset.pointValue}               # R$ por ponto por contrato
ACCOUNT_MODE = "${config.accountMode}"        # "HEDGE" ou "NETTING"
STRATEGY_MODE = "${config.strategyMode || 'PYRAMID_FLOW_CONFLUENCE'}"
MAX_POSITIONS = ${config.maxSimultaneousPositions || 10}

# CONFIGURAÇÕES DA PIRÂMIDE & CONFLUÊNCIA
PYRAMID_TP_POINTS = ${config.pyramidTpPoints || 50}          # TP de cada ordem da pirâmide (+50 pts)
PYRAMID_SL_POINTS = ${config.pyramidSlPoints || 0}        # Stop opcional da pirâmide (0 = sem stop fixo, saída só por inversão)
PYRAMID_CONTRACTS = ${config.pyramidContracts || 1}          # Lote das ordens de pirâmide
MAIN_CONTRACTS = ${config.contracts || 1}                    # Lote da ordem mãe de surfe
HOLD_MAIN_UNTIL_FLIP = ${config.holdMainUntilFlip !== false ? 'True' : 'False'}
CLOSE_ALL_ON_FLIP = ${config.closeAllOnFlowFlip !== false ? 'True' : 'False'}

# ENTRADA DA PIRÂMIDE (vale para mãe e pirâmides): "MARKET_ON_CLOSE", "BOX_50_LIMIT" ou "BOX_OPEN_LIMIT"
PYRAMID_ENTRY_TYPE = "${config.pyramidEntryType || 'MARKET_ON_CLOSE'}"
# Ao bater o TP de uma pirâmide, o stop da ordem mãe sobe para o breakeven (entrada + offset de taxas)
MAIN_BREAKEVEN_ON_PYR_TP = ${config.moveMainToBreakevenOnPyramidTp ? 'True' : 'False'}

# TIPO DE ENTRADA: "PULLBACK_ENTRY" ou "MARKET_ON_CLOSE"
ENTRY_TRIGGER_TYPE = "${config.entryTriggerType || 'MARKET_ON_CLOSE'}"
PULLBACK_TARGET = "${config.pullbackTarget || 'BOX_OPEN'}"
PULLBACK_CUSTOM_POINTS = ${config.pullbackCustomPoints || 25}
PULLBACK_MAX_BOXES_WAIT = ${config.pullbackMaxBoxesWait || 2}

BOX_POINTS = ${config.boxPoints || asset.renkoDefaults[Math.floor(asset.renkoDefaults.length / 2)]}                 # Tamanho do box em pontos (${asset.id})
MIN_DELTA_THRESHOLD = ${config.minDeltaThreshold || 0}   # Delta mínimo de agressão
REQUIRE_CVD_EXTREME = ${config.requireCvdNewExtreme ? 'True' : 'False'}

# LIMIAR ADAPTIVO DE REGIME — assimetria intradiária (curva em U de volume).
# Mesma fórmula do medidor web (SessionRegimeMeter): fator = volume médio dos
# últimos N boxes ÷ média do dia até agora, clampado em 0,5x–3,0x com aquecimento
# de 20 boxes / 15 minutos. Limiar efetivo = MIN_DELTA_THRESHOLD x fator x lado.
ADAPTIVE_THRESHOLD_ENABLED = ${config.adaptiveThresholdEnabled ? 'True' : 'False'}
REGIME_LOOKBACK_BOXES = ${config.regimeLookbackBoxes || 20}      # Janela rolling do medidor

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
# Padrão de trabalho: LIBERADO das 08:55 (leilão à vista, EA opera desde o 1º candle) e BLOQUEADO
# de 17:30 até 08:55 do dia seguinte, com zeragem compulsória às 17:30 (o WIN$N encerra 17:45).
TRADING_HOURS_ENABLED = ${config.tradingHoursEnabled ? 'True' : 'False'}
START_TIME = "${config.tradingStartTime || '08:55'}"
STOP_ENTRIES_TIME = "${config.tradingStopEntriesTime || '17:30'}"
CLOSE_ALL_TIME = "${config.tradingCloseAllTime || '17:30'}"

# ==============================================================================
# SEGURANÇA DA PONTE (LEIA ANTES DE LIGAR EM CONTA REAL)
# ==============================================================================
# Token compartilhado com o app. Ele nasce do localStorage do navegador que gerou este
# arquivo (Ajustes > Segurança da Ponte). VAZIO = modo legado: qualquer dispositivo da
# rede operaria esta conta, então o app avisa no login e no console abaixo.
AUTH_TOKEN = "${bridgeToken}"
REQUIRE_AUTH = len(AUTH_TOKEN) > 0

# Tetos aceitos pela ponte (defesa contra ordem perdida, loop de bug ou app clonado)
MAX_CONTRACTS_PER_ORDER = ${config.mt5MaxContractsPerOrder || 2}
MAX_ORDERS_PER_MINUTE = ${config.mt5MaxOrdersPerMinute || 12}

# Ações que ABREM posição exigem ponte armada (robô LIGADO no app). As de saída pedem
# só autenticação, porque encerrar posição reduz risco e você precisa poder zerar.
ENTRY_ACTIONS = {"ORDER_SEND"}
TRADE_ACTIONS = {"ORDER_SEND", "ORDER_PARTIAL_CLOSE", "ORDER_MODIFY_SL", "CLOSE_POSITIONS"}

# HISTÓRICO REAL (rota REQUEST_HISTORY): teto de dias corridos por pedido e tamanho do chunk
# transmitido. A corretora demo limita a profundidade disponível — pedir mais dias que isso
# simplesmente volta vazio, e o app cai no gerador sintético ROTULANDO a origem na tela.
HISTORY_MAX_DAYS = 10
HISTORY_CHUNK_TICKS = 1500
# Fração de ticks sem volume que liga o fallback das barras de 1min (tick de índice futuro no
# MT5 costuma chegar com volume 0, e é disso que vivem CVD, delta e convergência no app).
HISTORY_VOLUME_FALLBACK_RATIO = 0.8

# A ponte escuta em 0.0.0.0 = todas as interfaces da rede local,
# assim o app em OUTRO computador (ex: Mac) consegue conectar via Wi-Fi.
# O que protege não é o endereço (é o token acima), mas vale restringir no
# Firewall do Windows para aceitar a porta ${config.mt5Port || 8765} só do IP do computador do app.
WS_HOST = "0.0.0.0"
WS_PORT = ${config.mt5Port || 8765}

# Estado por conexão: quem provou o token, se pode abrir posição e histórico de ordens
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
    """Concentra as três travas (token, armado, tetos). Retorna (liberado, motivo)."""
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


# ==============================================================================
# MEDIDOR DE REGIME DE SESSÃO (paridade com o app web)
# ==============================================================================
class RegimeMeter:
    """Mede o regime da sessão a cada box fechado:
    fator de volume (janela recente vs média do dia) e fatores direcionais
    de pressão compradora x vendedora. Zera sozinho na virada de dia."""

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
        self.records = []          # (hora, volume_total, delta, fator)
        self.day_key = None
        self.day_vol_sum = 0
        self.day_pos_sum = 0
        self.day_pos_n = 0
        self.day_neg_sum = 0       # magnitude (positiva)
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
        """Limiar efetivo = fixo x fator de volume x fator direcional (clamp 0,5–3,0)."""
        dir_factor = self.last_buy if side == "BUY" else self.last_sell
        return round(base_threshold * self._clamp(self.last_factor * dir_factor, 0.5, 3.0))


# ==============================================================================
# MOTOR RENKO 10R E FLUXO ATEMPORAL
# ==============================================================================
class RenkoFlowEngine:
    def __init__(self, box_points=50):
        self.box_points = box_points
        self.boxes = []
        self.current_box = None
        self.cvd = 0.0
        self.regime_meter = RegimeMeter(REGIME_LOOKBACK_BOXES)

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
            # Medidor alimentado ANTES da avaliação: o box carrega o fator com que foi julgado
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
        limit_buy = self.regime_meter.get_adaptive_limit(MIN_DELTA_THRESHOLD, "BUY") if adaptive else MIN_DELTA_THRESHOLD
        limit_sell = self.regime_meter.get_adaptive_limit(MIN_DELTA_THRESHOLD, "SELL") if adaptive else MIN_DELTA_THRESHOLD
        factor_lbl = f" | volume factor {self.regime_meter.last_factor:.2f}x" if adaptive else ""

        if STRATEGY_MODE == "PYRAMID_FLOW_CONFLUENCE":
            if direction == "UP":
                # Com limiar adaptativo ligado, bloco verde fraco para o regime atual NÃO sinaliza
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
        self.main_tickets = {}   # ticket da ordem mãe -> direção ("BUY"/"SELL")
        self.pyramid_tickets = {} # ticket da pirâmide -> direção (para detectar o TP batido)

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

    def calculate_pyramid_entry_level(self, signal, box):
        """Nível da entrada da Pirâmide: fechamento a mercado, 50% do box ou abertura (entrada) do box"""
        if PYRAMID_ENTRY_TYPE == "BOX_50_LIMIT":
            return (box["open"] + box["close"]) / 2.0
        if PYRAMID_ENTRY_TYPE == "BOX_OPEN_LIMIT":
            return box["open"]
        return box["close"]

    def place_pyramid_limit_order(self, signal, box, comment="", volume=None, sl_points=0, tp_points=0):
        """Posiciona a LIMITADA de entrada da Pirâmide (mãe ou sub) no nível do box"""
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

        # BUY Limit precisa estar ABAIXO do mercado e SELL Limit ACIMA
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

        nivel = "entrada do box" if PYRAMID_ENTRY_TYPE == "BOX_OPEN_LIMIT" else "50% do box"
        print(f"⏳ [LIMIT PIRÂMIDE] {signal} {use_volume} ctro(s) em {limit_price:.1f} ({nivel}) | TP: {tp_price:.1f} | SL: {sl_price:.1f}")
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

    def place_websocket_limit_order(self, signal, limit_price, comment="", volume=None, sl_points=0, tp_points=0):
        """Posiciona uma LIMITADA solicitada pelo Terminal Web no preço informado"""
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
            "magic": self.magic_number,
            "comment": f"{ORDER_COMMENT} {comment}"[:31],
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": self.get_filling_mode(),
        }
        res = mt5.order_send(request)
        if res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"⏳ [WEB LIMIT] {signal} {use_volume} ctro(s) posicionada em {limit_price:.1f} | TP: {tp_price:.1f} | SL: {sl_price:.1f} | Ticket #{res.order}")
            return True, res.order
        print(f"[ERRO MT5 WEB LIMIT] RetCode={res.retcode}, Desc={res.comment}")
        return False, 0

    def move_main_to_breakeven(self, direction):
        """Move o SL da ordem mãe para a entrada + offset de taxas da B3"""
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
        """Detecta pirâmides que fecharam (TP batido) e protege a ordem mãe no breakeven"""
        if not MAIN_BREAKEVEN_ON_PYR_TP or not self.pyramid_tickets:
            return
        positions = mt5.positions_get(symbol=self.symbol)
        open_tickets = set(p.ticket for p in positions) if positions else set()
        for ticket in list(self.pyramid_tickets.keys()):
            if ticket in open_tickets:
                continue
            direction = self.pyramid_tickets.pop(ticket)
            print(f"🎯 [TP DA PIRÂMIDE #{ticket} {direction}] Movendo ordem mãe para o breakeven...")
            self.move_main_to_breakeven(direction)

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
            # Abre a ORDEM MÃE (SURFE) — a mercado ou Limit no nível do box, conforme PYRAMID_ENTRY_TYPE
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

            print(f"🟢 [ABRINDO ORDEM MÃE] {current_dir} {MAIN_CONTRACTS} ctro(s) no Box #{box['index']} | Sem TP fixo | Stop por inversão")
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
            # Já temos ordem mãe: abre ordem de PIRÂMIDE com TP configurado (e stop opcional se PYRAMID_SL_POINTS > 0)
            pyramid_num = pyramid_count + 1
            sl_info = f" | SL: -{PYRAMID_SL_POINTS} pts" if PYRAMID_SL_POINTS > 0 else " | sem stop fixo (saída por inversão)"
            entry_info = "a mercado no fechamento" if PYRAMID_ENTRY_TYPE == "MARKET_ON_CLOSE" else ("Limit na entrada do box" if PYRAMID_ENTRY_TYPE == "BOX_OPEN_LIMIT" else "Limit a 50% do box")
            print(f"🔺 [ABRINDO PIRÂMIDE #{pyramid_num}] {current_dir} {PYRAMID_CONTRACTS} ctro(s) no Box #{box['index']} | {entry_info} | TP: +{PYRAMID_TP_POINTS} pts{sl_info}")
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

async def send_account_info(websocket):
    """Só é chamada depois de a conexão provar o token (ou no modo legado)."""
    acc = mt5.account_info()
    state = client_state(websocket)
    await send_json(websocket, {
        "type": "ACCOUNT_INFO",
        "data": {
            "login": acc.login if acc else 0,
            "broker": acc.company if acc else "MetaTrader 5",
            "balance": acc.balance if acc else 0.0,
            "entryTriggerType": ENTRY_TRIGGER_TYPE,
            "pullbackTarget": PULLBACK_TARGET,
            "partialExit": ENABLE_PARTIAL_EXIT,
            "trailingStop": TRAILING_STOP,
            "requireAuth": REQUIRE_AUTH,
            "armed": state["armed"],
            "symbol": SYMBOL,
            "decimals": ASSET_DECIMALS,
            "maxContractsPerOrder": MAX_CONTRACTS_PER_ORDER,
            "maxOrdersPerMinute": MAX_ORDERS_PER_MINUTE
        }
    })

async def ws_handler(websocket):
    peer = get_peer_ip(websocket)
    CONNECTED_CLIENTS.add(websocket)
    state = client_state(websocket)

    if REQUIRE_AUTH:
        print(f" 🔌 {peer} conectou — aguardando AUTH com o token antes de entregar qualquer dado")
    else:
        print(" ⚠️  AUTH_TOKEN está VAZIO: modo legado, qualquer dispositivo da rede opera esta conta.")
        print("     Abra o app em Ajustes > Segurança da Ponte, gere um token e baixe o script de novo.")
        await send_account_info(websocket)

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue
            action = data.get("action")

            if action == "AUTH":
                provided = str(data.get("token") or "")
                matches = bool(AUTH_TOKEN) and secrets.compare_digest(provided, AUTH_TOKEN)
                wants_armed = bool(data.get("armed", False))
                if REQUIRE_AUTH:
                    state["authenticated"] = matches
                    state["armed"] = matches and wants_armed
                else:
                    state["authenticated"] = True
                    state["armed"] = wants_armed
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
                    print(f" 🔑 AUTH OK de {peer} — ponte {'ARMADA (entradas liberadas)' if state['armed'] else 'EM SEGURO (sem entradas)'}")
                else:
                    print(f" ⛔ AUTH RECUSADO de {peer} — token errado. Nenhum dado entregue.")
                    await websocket.close(code=4001, reason="token invalido")
                continue

            if action in ("ARM", "DISARM"):
                if REQUIRE_AUTH and not state["authenticated"]:
                    print(f" ⛔ {action} de {peer} sem autenticação — ignorado")
                    continue
                state["armed"] = action == "ARM"
                await send_json(websocket, {"type": "ARM_RESULT", "data": {"armed": state["armed"]}})
                print(f" {'🟢 PONTE ARMADA: ordens de entrada liberadas' if state['armed'] else '🔒 PONTE EM SEGURO: nenhuma entrada nova'} — {peer}")
                continue

            if action == "REQUEST_HISTORY":
                # Histórico só entrega DADO de mercado e nunca toca ordem, então a única trava é o
                # token (a mesma do broadcast_to_web): ponte EM SEGURO também atende normalmente.
                if REQUIRE_AUTH and not state["authenticated"]:
                    print(f" ⛔ REQUEST_HISTORY de {peer} sem autenticação — ignorado")
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
                    print(f" ⛔ ORDEM REJEITADA de {peer} ({action}): {reason}")
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
                    if data.get("isLimit"):
                        ORDER_MANAGER.place_websocket_limit_order(
                            data.get("type", "BUY"),
                            float(data.get("limitPrice") or 0),
                            data.get("comment", "WEB_LIMIT"),
                            data.get("contracts", 1),
                            data.get("sl", 0) or 0,
                            data.get("tp", 0) or 0
                        )
                    else:
                        ORDER_MANAGER.execute_market_order(
                            data.get("type", "BUY"),
                            comment=data.get("comment", "WEB_ORDER"),
                            volume=data.get("contracts", 1),
                            sl_points=data.get("sl", 0) or 0,
                            tp_points=data.get("tp", 0) or 0
                        )
                elif action == "ORDER_PARTIAL_CLOSE":
                    ORDER_MANAGER.close_partial_position(data.get("ticket"), data.get("partialVolume"), data.get("newSL"))
                elif action == "ORDER_MODIFY_SL":
                    ORDER_MANAGER.modify_stop_loss(data.get("ticket"), data.get("newSL"))
                elif action == "CLOSE_POSITIONS":
                    ORDER_MANAGER.close_all_positions()
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
    for client in CONNECTED_CLIENTS:
        state = CLIENT_STATES.get(client)
        # conexão sem token não recebe tick, nem book, nada
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


def _history_tick_record(raw, seq):
    """Tick cru do MT5 no MESMO shape do TICK ao vivo — o app já sabe ler isto, não precisa
    de um segundo contrato. O campo "id" é único e estável porque o front deduplica por id."""
    time_msc = int(_field(raw, "time_msc", 0) or 0)
    flags = int(_field(raw, "flags", 0) or 0)
    if flags & mt5.TICK_FLAG_BUY:
        aggressor = "BUY"
    elif flags & mt5.TICK_FLAG_SELL:
        aggressor = "SELL"
    else:
        aggressor = "CROSS"
    return {
        "id": f"mt5-h-{time_msc}-{seq}",
        "timestamp": time_msc,
        "timeStr": datetime.fromtimestamp(time_msc / 1000).strftime('%H:%M:%S.%f')[:-3],
        "price": round(float(_field(raw, "price", 0) or 0), ASSET_DECIMALS),
        "volume": int(_field(raw, "volume", 0) or 0),
        "aggressor": aggressor,
    }


def _apply_m1_volume(symbol, ticks):
    """Tick de índice futuro no MT5 chega quase sempre com volume 0 e flag CROSS — e é disso que
    vivem CVD, delta e convergência no app (sem volume a estratégia não erra: ela fica MUDA).
    Distribui o tick_volume da barra de 1min entre os ticks daquele minuto e atribui agressão por
    uptick/downtick quando a flag não veio. Devolve False se nem as barras existem."""
    date_from = datetime.fromtimestamp(ticks[0]["timestamp"] / 1000, timezone.utc)
    date_to = datetime.fromtimestamp(ticks[-1]["timestamp"] / 1000, timezone.utc)
    rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, date_from, date_to)
    if rates is None or len(rates) == 0:
        return False

    volume_per_minute = {}
    for r in rates:
        minute = int(_field(r, "time", 0) or 0) // 60 * 60
        volume_per_minute[minute] = int(_field(r, "tick_volume", 0) or 0)

    groups = {}
    for i, t in enumerate(ticks):
        groups.setdefault(t["timestamp"] // 1000 // 60 * 60, []).append(i)
    for minute, indexes in groups.items():
        total = volume_per_minute.get(minute, 0)
        if total <= 0:
            continue
        base, extra = divmod(total, len(indexes))
        for pos, i in enumerate(indexes):
            ticks[i]["volume"] = base + (1 if pos < extra else 0)

    for i in range(1, len(ticks)):
        if ticks[i]["aggressor"] != "CROSS":
            continue
        if ticks[i]["price"] > ticks[i - 1]["price"]:
            ticks[i]["aggressor"] = "BUY"
        elif ticks[i]["price"] < ticks[i - 1]["price"]:
            ticks[i]["aggressor"] = "SELL"
    return True


async def handle_request_history(websocket, req_id, symbol, days):
    """Histórico REAL pedido pelo Terminal Web. A chamada bloqueante do MT5 vai para uma thread e
    os ticks descem em HISTORY_CHUNK (o feed ao vivo continua transmitindo durante todo o tempo);
    zero ticks ou exceção viram HISTORY_ERROR com motivo legível — nunca um DONE vazio, porque o
    app precisa saber que caiu no gerador sintético."""
    try:
        days = max(1, min(HISTORY_MAX_DAYS, int(days or 1)))
    except (TypeError, ValueError):
        days = 1
    date_to = datetime.now(timezone.utc)
    date_from = date_to - timedelta(days=days)

    try:
        raw_ticks = await asyncio.to_thread(mt5.copy_ticks_range, symbol, date_from, date_to, mt5.COPY_TICKS_TRADE)
    except Exception as exc:
        await send_json(websocket, {
            "type": "HISTORY_ERROR",
            "data": {"reqId": req_id, "reason": f"mt5.copy_ticks_range falhou: {exc}"}
        })
        return

    if raw_ticks is None or len(raw_ticks) == 0:
        hint = "o contrato não existe no terminal logado" if mt5.symbol_info(symbol) is None else \
               "a conta não tem essa profundidade de histórico (peça menos dias)"
        await send_json(websocket, {
            "type": "HISTORY_ERROR",
            "data": {"reqId": req_id, "reason": f"Zero ticks de '{symbol}' nos últimos {days} dia(s) — {hint}."}
        })
        return

    ticks = [_history_tick_record(raw, i) for i, raw in enumerate(raw_ticks)]
    ticks.sort(key=lambda t: (t["timestamp"], t["id"]))

    volume_source = "TICK"
    zero_volume = sum(1 for t in ticks if t["volume"] <= 0)
    if zero_volume >= max(1, int(len(ticks) * HISTORY_VOLUME_FALLBACK_RATIO)):
        fixed = await asyncio.to_thread(_apply_m1_volume, symbol, ticks)
        volume_source = "M1_RATE" if fixed else "NONE"

    total = len(ticks)
    chunks = 0
    for start in range(0, total, HISTORY_CHUNK_TICKS):
        await send_json(websocket, {
            "type": "HISTORY_CHUNK",
            "data": {
                "reqId": req_id,
                "index": chunks,
                "volumeSource": volume_source,
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
            "volumeSource": volume_source
        }
    })
    print(f"📜 HISTÓRICO enviado a {get_peer_ip(websocket)}: {total} ticks de '{symbol}' ({days} dia(s), volume {volume_source}) em {chunks} chunk(s).")


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

                    # Limpa ordens de pullback/limit antigas que expiraram
                    ORDER_MANAGER.check_and_clean_expired_pending(new_box["index"])
                    # Se alguma pirâmide fechou no TP, protege a ordem mãe no breakeven
                    ORDER_MANAGER.watch_closed_pyramids()

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
    print(f" Servidor WebSocket ativo em toda a rede local na porta {WS_PORT} — no app (outro PC da rede) use MT5 Host = IP desta maquina (veja ipconfig)")
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
