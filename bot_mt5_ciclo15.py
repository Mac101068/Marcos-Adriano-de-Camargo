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

import os
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):

    sys.stdout.reconfigure(encoding="utf-8")



import time

import json

import secrets

import asyncio


# Diário de auditoria: grava tudo que o robô julgou e tudo que ele de FATO enviou à
# corretora. O import é protegido porque a ponte precisa continuar operando mesmo se o
# módulo não estiver no caminho (arquivo esquecido, pasta errada) — auditoria nenhuma
# vale um pregão parado.
try:

    from auditoria_diario import (
        registrar_box as audit_registrar_box,
        registrar_ordem as audit_registrar_ordem,
        salvar_deals_mt5 as audit_salvar_deals,
        salvar_snapshot_conta as audit_salvar_conta,
    )

    AUDITORIA_ENABLED = os.getenv("AUDITORIA_OFF", "") not in ("1", "true", "TRUE")

except Exception as _audit_exc:  # fallback de emergência

    AUDITORIA_ENABLED = False

    print(f"[AVISO] Diário de auditoria indisponível: {_audit_exc}", flush=True)

# Camada de dados do replay de validação: ticks REAIS dos recortes em disco, comprimidos por
# bucket. Import protegido pelo mesmo motivo do diário — se o arquivo não estiver no caminho, a
# ponte segue atendindo histórico pelo M1 (e a tela lê a fonte rotulada, sem se enganar).
try:

    import replay_dados as replay

    REPLAY_DADOS_ENABLED = True

except Exception as _replay_exc:

    replay = None

    REPLAY_DADOS_ENABLED = False

    print(f"[AVISO] Replay de ticks reais indisponível: {_replay_exc}", flush=True)

from datetime import datetime, timezone, timedelta

import MetaTrader5 as mt5

import numpy as np

from bisect import bisect_left, bisect_right

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
        "min_delta": 300,
        "magic": 150101,
        "contracts": 2,
        "sl_points": 50.0,
        "tp_points": 100.0,
        "partial_points": 50.0,
        "pyramid_contracts": 1,
        "pyramid_tp_points": 50.0,
        "pyramid_sl_points": 50.0,
        "max_pyramids": 3,
        "breakeven_offset_ticks": 1,
        "max_spread_ticks": 3,
        "max_daily_loss": 500.0,
        "max_daily_profit": 1000.0,
        "trailing_stop_enabled": True,
    },
    "WDO": {
        "symbol": "WDOZ26",
        "continuous": "WDO$",
        "label": "Mini-Dólar B3",
        "decimals": 1,
        "tick_size": 0.5,
        "point_value": 10.0,
        "box_points": 2.5,
        "min_delta": 400,
        "magic": 150201,
        "contracts": 1,
        "sl_points": 2.5,
        "tp_points": 5.0,
        "partial_points": 2.5,
        "pyramid_contracts": 1,
        "pyramid_tp_points": 2.5,
        "pyramid_sl_points": 2.5,
        "max_pyramids": 3,
        "breakeven_offset_ticks": 1,
        "max_spread_ticks": 3,
        "max_daily_loss": 300.0,
        "max_daily_profit": 600.0,
        "trailing_stop_enabled": True,
    },
    "BTCBR": {
        "symbol": "BITX26",
        "continuous": "BIT$",
        "label": "Bitcoin B3 (BTCBR / BIT)",
        "decimals": 0,
        "tick_size": 20.0,
        "point_value": 0.1,
        "box_points": 100.0,
        "min_delta": 35,
        "magic": 150301,
        "contracts": 1,
        "sl_points": 200.0,
        "tp_points": 400.0,
        "partial_points": 200.0,
        "pyramid_contracts": 1,
        "pyramid_tp_points": 100.0,
        "pyramid_sl_points": 100.0,
        "max_pyramids": 3,
        "breakeven_offset_ticks": 1,
        "max_spread_ticks": 3,
        "max_daily_loss": 300.0,
        "max_daily_profit": 600.0,
        "trailing_stop_enabled": True,
    },
    "BTC": {
        "symbol": "BITX26",
        "continuous": "BIT$",
        "label": "Bitcoin B3 (BTCBR / BIT)",
        "decimals": 0,
        "tick_size": 20.0,
        "point_value": 0.1,
        "box_points": 100.0,
        "min_delta": 35,
        "magic": 150301,
        "contracts": 1,
        "sl_points": 200.0,
        "tp_points": 400.0,
        "partial_points": 200.0,
        "pyramid_contracts": 1,
        "pyramid_tp_points": 100.0,
        "pyramid_sl_points": 100.0,
        "max_pyramids": 3,
        "breakeven_offset_ticks": 1,
        "max_spread_ticks": 3,
        "max_daily_loss": 300.0,
        "max_daily_profit": 600.0,
        "trailing_stop_enabled": True,
    },
}



# ==============================================================================
# CONFIGURAÇÕES DO ROBÔ 2: VARAL DE ORDENS (SOMBRA REAL NO MT5)
# ==============================================================================
VARAL_CONFIG = {
    "WIN": {
        "enabled": True,
        "magic": 150102,
        "execution_type": "MARKET",  # "MARKET" (A Mercado no fechamento do bloco) ou "LIMIT" (Pendente)
        "step_points": 50.0,
        "max_orders": 3,      # Editável: 3, 4, 5 ordens
        "contracts": 1,
        "tp_points": 50.0,    # Editável
        "sl_points": 50.0,
    },
    "WDO": {
        "enabled": True,
        "magic": 150202,
        "execution_type": "MARKET",  # "MARKET" ou "LIMIT"
        "step_points": 2.5,
        "max_orders": 3,
        "contracts": 1,
        "tp_points": 5.0,     # Editável
        "sl_points": 2.5,
    },
    "BIT": {
        "enabled": True,
        "magic": 150302,
        "execution_type": "MARKET",  # "MARKET" ou "LIMIT"
        "step_points": 100.0,
        "max_orders": 3,
        "contracts": 1,
        "tp_points": 200.0,   # Editável
        "sl_points": 100.0,
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

# Modos Operacionais dos Robôs por Ativo: "COPILOT" (Operador administra entradas), "AUTO" (Execução automática) ou "SHADOW"
ROBOT_MODES = {
    "WIN": "COPILOT",
    "WDO": "COPILOT",
    "BIT": "COPILOT",
}



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



# ESPELHO DOS PADRÕES DO APP (interface_github/src/services/eaConfigService.ts): a ponte
# precisa julgar com os MESMOS números e os MESMOS filtros que a tela desenha. Quando a
# tela abre, SYNC_EA_CONFIG sobrescreve isto aqui — ver EVAL_CONFIG abaixo.
ADAPTIVE_THRESHOLD_ENABLED = True

REGIME_LOOKBACK_BOXES = 20

# P60 das agressões do próprio lado, calculado do pregão (regra: limiar é calculado)
SESSION_PERCENTILE = 0.6

# Piso do gate estático da Pirâmide — o mesmo Math.max(50, minDelta) do avaliador da tela
PYRAMID_STATIC_FLOOR = 50

# Consolidação: Efficiency Ratio abaixo disto = mercado girando em círculo, bloco mudo
CONSOLIDATION_FILTER_ENABLED = True

CONSOLIDATION_LOOKBACK_BOXES = 10

CONSOLIDATION_ER_MAX = 0.35

# Exaustão: opcional, ligada só por decisão do operador (no app também vem desligada)
EXHAUSTION_FILTER_ENABLED = False

EXHAUSTION_DELTA_RATIO = 0.7



# Valores VIGENTES na avaliação do sinal. É o que check_convergence lê.
EVAL_CONFIG = {
    "strategy_mode": STRATEGY_MODE,
    "adaptive": ADAPTIVE_THRESHOLD_ENABLED,
    "regime_lookback": REGIME_LOOKBACK_BOXES,
    "percentile": 0.7,
    "floor_multiple": 1.6,
    "flow_divergence_min": 0.15,
    "anti_absorption_enabled": True,
    "pyramid_static_floor": PYRAMID_STATIC_FLOOR,
    "consolidation_enabled": CONSOLIDATION_FILTER_ENABLED,
    "consolidation_lookback": CONSOLIDATION_LOOKBACK_BOXES,
    "consolidation_er_max": CONSOLIDATION_ER_MAX,
    "exhaustion_enabled": EXHAUSTION_FILTER_ENABLED,
    "exhaustion_ratio": EXHAUSTION_DELTA_RATIO,
    "require_cvd_extreme": REQUIRE_CVD_EXTREME,
}



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

def sync_token_files(token: str, paths=None):
    if not token or len(token) < 16:
        return
    if paths is None:
        base_dir = Path(__file__).resolve().parent
        paths = [
            base_dir / "bridge_token.txt",
            base_dir / "interface_github" / "public" / "bridge_token.txt"
        ]
    for p in paths:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(token, encoding="utf-8")
        except Exception:
            pass

def load_or_create_bridge_token() -> str:
    env_token = os.getenv("BRIDGE_TOKEN", "").strip()
    if env_token and len(env_token) >= 16:
        sync_token_files(env_token)
        return env_token

    base_dir = Path(__file__).resolve().parent
    token_paths = [
        base_dir / "bridge_token.txt",
        base_dir / "interface_github" / "public" / "bridge_token.txt"
    ]

    for p in token_paths:
        if p.is_file():
            try:
                content = p.read_text(encoding="utf-8").strip()
                if len(content) >= 16:
                    sync_token_files(content, token_paths)
                    return content
            except Exception:
                pass

    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    token = ''.join(secrets.choice(alphabet) for _ in range(28))
    sync_token_files(token, token_paths)
    return token

# Token carregado/criado de forma sincronizada com o frontend
AUTH_TOKEN = load_or_create_bridge_token()

REQUIRE_AUTH = True




MAX_CONTRACTS_PER_ORDER = 2

MAX_ORDERS_PER_MINUTE = 12



ENTRY_ACTIONS = {"ORDER_SEND"}

TRADE_ACTIONS = {"ORDER_SEND", "ORDER_PARTIAL_CLOSE", "ORDER_MODIFY_SL", "CLOSE_POSITIONS"}


# Trava de execução por ambiente. PADRÃO = DESLIGADA (não muda o comportamento de hoje); com
# ORDERS_BLOCKED=1 a ponte serve tudo (ticks, histórico, sinais, diário) mas nenhuma ordem de
# entrada sai, mesmo com cliente ARMADO. Existe por dois motivos, e o segundo é o que quebra
# replay de validação: (1) reiniciar a ponte com a tela do operador aberta re-autentica com
# `armed: config.active`, ou seja, o robô volta armado sem ninguém ter dito sim naquela sessão;
# (2) a tela pode querer rodar um replay do pregão enquanto o loop vivo continua vendo ticks reais
# -- sem esta trava o SINAL GERADO do loop vivo executa ordem real no meio do ensaio.
ORDERS_BLOCKED = os.environ.get("ORDERS_BLOCKED", "").strip().lower() in ("1", "true", "sim", "on")

# Versão ACIONÁVEL da mesma trava, para não precisar reiniciar a ponte a cada sessão de estudo:
# a tela manda {"action":"SET_REPLAY_MODE","on":true} e o processo passa a segurar as entradas.
# Não é persistente -- morre com o processo, que é justamente o desejado: ninguém acorda no dia
# seguinte com o robô ensaiando sem querer. A trava de ambiente fica por cima dela: ligar pelo app
# sempre funciona, desligar pelo app nunca vence um ORDERS_BLOCKED=1 definido no PC do MT5.
REPLAY_MODE = False
LAST_TAPE_TIME_MSC = {}


def ordens_bloqueadas():
    """Verdade única da trava: ambiente (irreversível por rede) OU modo replay ligado na tela."""
    return bool(ORDERS_BLOCKED or REPLAY_MODE)



HISTORY_MAX_DAYS = 10

HISTORY_CHUNK_TICKS = 1500

HISTORY_VOLUME_FALLBACK_RATIO = 0.8

# Fontes de volume declaradas no protocolo HISTORY_*. O nome não é enfeite: é o que impede a tela
# de desenhar um replay decorativo com cara de validação. `TICKS_REAIS` = fita da B3 comprimida por
# bucket (fluxo e caminho preservados); `M1_RATE` = 4 ticks fabricados por barra de 1 minuto.
VOLUME_SOURCE_TICKS_REAIS = "TICKS_REAIS"

VOLUME_SOURCE_M1 = "M1_RATE"



WS_HOST = "0.0.0.0"

WS_PORT = 8765

# Mesmo caminho usado por config.py/extrair_ticks.py (terminal da XP, já logado em demo)
MT5_PATH = os.getenv("MT5_PATH", r"C:\Program Files\MetaTrader 5 Terminal\terminal64.exe")



# Quantas sessões o backfill entrega ao gráfico ao conectar: hoje + as anteriores.
# Duas anteriores são o mínimo para o operador ver a emenda do pregão e o gap de abertura.
BACKFILL_SESSIONS = max(1, int(os.getenv("BACKFILL_SESSIONS", "3")))



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

    if action in ENTRY_ACTIONS and ordens_bloqueadas():

        return False, ("ponte com TRAVA DE EXECUÇÃO ativa (" + ("ORDERS_BLOCKED=1" if ORDERS_BLOCKED else "MODO REPLAY ligado na tela") + "): nenhuma ordem de "
                       "ENTRADA sai, armada ou não. Saídas (parcial, stop, zeragem) seguem LIBERADAS "
                       "de propósito: encerrar posição reduz risco e você precisa poder se proteger "
                       "no meio de um ensaio")

    # Ordens manuais da boleta ou do modo Copiloto disparadas pelo operador:
    comment = str(data.get("comment", ""))
    is_operator_order = bool(
        comment.startswith("COPILOT") or
        comment.startswith("WEB_") or
        comment.startswith("MAE_") or
        comment.startswith("PIR_") or
        comment.startswith("VARAL_") or
        data.get("magic") in (MANUAL_ORDER_MAGIC, 150101, 150201, 150301, 150102, 150202, 150302)
    )

    if action in ENTRY_ACTIONS and not state["armed"] and not is_operator_order:

        return False, "ponte EM SEGURO: ligue o Robô no app para liberar entradas automáticas"

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



    def set_lookback(self, lookback_boxes):
        self.lookback = max(3, min(100, int(lookback_boxes) or 20))

    def get_self_calibrated_limit(self, base_threshold, side, percentile=0.7, floor_multiple=1.6):
        """Limiar AUTO-CALIBRADO do pregão (Ciclos 17/18 SEL-A):
        Maior entre o percentil das agressões na janela móvel dos últimos `lookback` boxes
        e o piso relativo de `floor_multiple` × média do dia inteiro daquele lado.
        Atualizado automaticamente a cada box fechado com base na janela configurada.
        """
        win = self.records[-max(3, self.lookback):]
        if side == "BUY":
            mags = sorted(r[2] for r in win if r[2] > 0)
            day_n = self.day_pos_n
            day_sum = self.day_pos_sum
        else:
            mags = sorted(-r[2] for r in win if r[2] < 0)
            day_n = self.day_neg_n
            day_sum = self.day_neg_sum

        day_mean = day_sum / day_n if day_n >= 5 else None
        floor_mult = self._clamp(float(floor_multiple), 1.0, 5.0)
        floor_value = day_mean * floor_mult if day_mean is not None else None

        min_records = min(10, max(3, self.lookback))
        min_samples = min(5, max(2, self.lookback // 3))

        if len(self.records) < min_records or len(mags) < min_samples:
            return max(1, int(round(base_threshold)))

        pct = self._clamp(float(percentile), 0.0, 0.95)
        idx = min(len(mags) - 1, int(pct * len(mags)))
        p = mags[idx]

        use_floor = floor_value is not None and floor_value > p
        effective = floor_value if use_floor else p
        return max(1, int(round(effective)))

    def get_percentile_limit(self, base_threshold, side, percentile=0.6):
        """Limiar CALCULADO do pregão: percentil `percentile` das agressões do próprio lado.

        É a réplica de SessionRegimeMeter.getPercentileLimit() do app: corte baseado no
        percentil das agressões dos últimos `lookback` boxes.
        """
        min_records = min(10, max(3, self.lookback))
        if len(self.records) < min_records:
            return self.get_adaptive_limit(base_threshold, side)

        win = self.records[-max(3, self.lookback):]

        # records[i] = (hour, volume, delta, fator): agressão líquida do box está no índice 2
        if side == "BUY":
            mags = sorted(r[2] for r in win if r[2] > 0)
        else:
            mags = sorted(-r[2] for r in win if r[2] < 0)

        min_samples = min(5, max(2, self.lookback // 3))
        if len(mags) < min_samples:
            return self.get_adaptive_limit(base_threshold, side)

        pct = self._clamp(float(percentile), 0.0, 0.95)
        idx = min(len(mags) - 1, int(pct * len(mags)))
        return max(1, int(round(mags[idx])))





def efficiency_ratio(previous_boxes, box, lookback):
    """Efficiency Ratio (Kaufman) das últimas `lookback` barras fechadas.

    |deslocamento líquido| ÷ Σ|passo a passo|: perto de 1 é tendência limpa, perto de 0 o
    mercado gira em círculo (acumulação / range curto). Como cada box Renko fecha exatamente
    um degrau, a conta vira medida de alternância: 9 passos com saldo de 3 degraus já é
    acumulação — e bloco verde dentro de range não é confluência nenhuma.
    Réplica de efficiencyRatio() do avaliador da tela.
    """
    k = max(2, int(round(lookback)) or 10)
    series = [b["close"] for b in previous_boxes[-(k - 1):]] + [box["close"]]
    if len(series) < k:
        return 1.0
    path = 0.0
    for i in range(1, len(series)):
        path += abs(series[i] - series[i - 1])
    if path <= 0:
        return 1.0
    return min(1.0, abs(series[-1] - series[0]) / path)




def is_exhausted_flow(previous_boxes, box, ratio):
    """Exaustão de fluxo: a agressão do box atual caiu a `ratio` (ou menos) da do último
    box do MESMO lado. Fluxo que emagrece não é continuidade, é a última perna.
    Réplica de isExhaustedFlow() do avaliador da tela.
    """
    d = box.get("delta", 0) or 0
    if d == 0:
        return False
    for prev in reversed(previous_boxes):
        pd = prev.get("delta", 0) or 0
        if pd != 0 and (pd > 0) == (d > 0):
            return abs(d) <= abs(pd) * ratio
    return False


def compute_flow_conviction_score(box, previous_boxes, regime_meter, base_thresh, direction):
    """Calcula o Score de Convicção Institucional (0 a 10 pontos) para o box de sinal.
    Critérios:
    1. Força do Delta vs Histórico (0 a 3 pts):
       - Delta >= P90: +3 pts
       - Delta >= P80: +2 pts
       - Delta >= P70: +1 pt
    2. Divergência de Fluxo (|Delta| / Volume) (0 a 2 pts):
       - Div >= 35%: +2 pts
       - Div >= 20%: +1 pt
    3. Alinhamento de CVD (0 a 2 pts):
       - Novo topo/fundo histórico do dia: +2 pts
       - CVD inclinado a favor nos últimos 3 boxes: +1 pt
    4. Eficiência de Kaufman (ER) (0 a 2 pts):
       - ER >= 0.70: +2 pts
       - ER >= 0.45: +1 pt
    5. Velocidade de Formação do Box (0 a 1 pt):
       - Box fechou em <= 40% do tempo médio recente: +1 pt
    """
    delta = abs(box.get("delta", 0) or 0)
    side = "BUY" if direction == "UP" else "SELL"

    # 1. Delta vs percentis do regime
    p90 = regime_meter.get_self_calibrated_limit(base_thresh, side, percentile=0.90, floor_multiple=1.6)
    p80 = regime_meter.get_self_calibrated_limit(base_thresh, side, percentile=0.80, floor_multiple=1.4)
    p70 = regime_meter.get_self_calibrated_limit(base_thresh, side, percentile=0.70, floor_multiple=1.2)

    if delta >= p90:
        pts_delta = 3
    elif delta >= p80:
        pts_delta = 2
    elif delta >= p70:
        pts_delta = 1
    else:
        pts_delta = 0

    # 2. Divergência de fluxo (|Delta| / Volume)
    vol = max(1, int(box.get("total_volume") or box.get("volume") or 0))
    div = delta / vol
    if div >= 0.35:
        pts_div = 2
    elif div >= 0.20:
        pts_div = 1
    else:
        pts_div = 0

    # 3. CVD
    cvd = box.get("cvd_at_close", 0) or 0
    pts_cvd = 0
    if previous_boxes:
        all_prev_cvd = [b.get("cvd_at_close", 0) for b in previous_boxes if "cvd_at_close" in b]
        if all_prev_cvd:
            if direction == "UP" and cvd >= max(all_prev_cvd):
                pts_cvd = 2
            elif direction == "DOWN" and cvd <= min(all_prev_cvd):
                pts_cvd = 2
            elif len(all_prev_cvd) >= 2:
                last_few = all_prev_cvd[-3:]
                if direction == "UP" and all(last_few[i] <= last_few[i+1] for i in range(len(last_few)-1)):
                    pts_cvd = 1
                elif direction == "DOWN" and all(last_few[i] >= last_few[i+1] for i in range(len(last_few)-1)):
                    pts_cvd = 1
    else:
        pts_cvd = 1

    # 4. Efficiency Ratio
    er = efficiency_ratio(previous_boxes, box, 10)
    if er >= 0.70:
        pts_er = 2
    elif er >= 0.45:
        pts_er = 1
    else:
        pts_er = 0

    # 5. Velocidade
    pts_speed = 0
    t_start = box.get("time_start", 0)
    t_end = box.get("timestamp", 0)
    if t_start and t_end and t_end > t_start:
        cur_dur = (t_end - t_start) / 1000.0
        recent_durs = [
            (b.get("timestamp", 0) - b.get("time_start", 0)) / 1000.0
            for b in previous_boxes[-10:]
            if b.get("timestamp") and b.get("time_start") and b.get("timestamp") > b.get("time_start")
        ]
        if recent_durs:
            avg_dur = sum(recent_durs) / len(recent_durs)
            if cur_dur <= avg_dur * 0.4 and cur_dur >= 0.1:
                pts_speed = 1
        elif cur_dur < 10.0:
            pts_speed = 1

    total_score = min(10, max(0, pts_delta + pts_div + pts_cvd + pts_er + pts_speed))
    breakdown = {
        "delta_pts": pts_delta,
        "div_pts": pts_div,
        "cvd_pts": pts_cvd,
        "er_pts": pts_er,
        "speed_pts": pts_speed,
        "total": total_score
    }
    return total_score, breakdown


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
        """Julga o box com as MESMAS regras do avaliador da tela (convergenceEvaluator.ts).

        Paridade é requisito de segurança: se a tela desenha uma seta e a ponte compra outra
        coisa, o operador não está auditando o que enxerga. A ordem dos gates é idêntica à do
        app: 1) Delta acima do limiar do lado — SEMPRE aplicado, adaptativo ligado ou não
        (antes o filtro estava preso ao `adaptive and` e com adaptativo desligado nenhum box
        era cortado, nem um BUY com Delta negativo); 2) regime, por consolidação (Efficiency
        Ratio) e exaustão de fluxo; 3) no modo clássico, CVD em novo extremo se exigido.
        """
        delta = box["delta"]
        direction = box["direction"]
        cfg = EVAL_CONFIG
        # boxes fechados ANTES deste: o process_tick anexa o box atual antes de julgar
        previous_boxes = self.boxes[:-1] if (self.boxes and self.boxes[-1] is box) else list(self.boxes)
        adaptive = bool(cfg["adaptive"])
        base_thresh = self.min_delta_threshold
        pyramid = cfg["strategy_mode"] == "PYRAMID_FLOW_CONFLUENCE"
        pct = float(cfg.get("percentile", 0.7))
        flr = float(cfg.get("floor_multiple", 1.6))
        limit_buy = (
            self.regime_meter.get_self_calibrated_limit(base_thresh, "BUY", pct, flr)
            if adaptive else base_thresh
        )
        limit_sell = (
            self.regime_meter.get_self_calibrated_limit(base_thresh, "SELL", pct, flr)
            if adaptive else base_thresh
        )
        # Com adaptativo o corte é o auto-calibrado; na Pirâmide estática o app usa max(50, minDelta)
        req_buy = limit_buy if (adaptive or not pyramid) else max(cfg["pyramid_static_floor"], base_thresh)
        req_sell = limit_sell if (adaptive or not pyramid) else max(cfg["pyramid_static_floor"], base_thresh)

        # Filtro de divergência de fluxo (SEL-A: |Δ| ÷ volume >= min)
        div_min = float(cfg.get("flow_divergence_min", 0.15)) if pyramid else 0.0
        tot_vol = max(1, int(box.get("total_volume") or box.get("volume") or 0))
        divergence = abs(delta) / tot_vol
        divergence_ok = (divergence >= div_min) if (pyramid and div_min > 0) else True

        # Detecção e Filtro de Absorção Institucional (Box fecha a favor mas Delta fecha oposto)
        is_absorbed = (direction == "UP" and delta <= 0) or (direction == "DOWN" and delta >= 0)
        box["is_absorption"] = is_absorbed

        # O Efficiency Ratio é medido SEMPRE, com o filtro ligado ou não: é a coluna que permite
        # auditar depois se o filtro de acumulação teria ajudado. Custa ~10 subtrações por box.
        er = efficiency_ratio(previous_boxes, box, cfg["consolidation_lookback"])
        consolidating = bool(cfg["consolidation_enabled"]) and er < cfg["consolidation_er_max"]
        exhausting = bool(cfg["exhaustion_enabled"]) and is_exhausted_flow(
            previous_boxes, box, cfg["exhaustion_ratio"])
        regime_block = consolidating or exhausting

        # Score de Convicção Institucional de Fluxo (0 a 10)
        flow_score, score_breakdown = compute_flow_conviction_score(
            box, previous_boxes, self.regime_meter, base_thresh, direction
        )
        box["flow_score"] = flow_score
        box["flow_score_breakdown"] = score_breakdown

        factor_lbl = f" | limiar = P{int(pct * 100)} SEL-A (janela {self.regime_meter.lookback}b)" if adaptive else ""

        # Vereditão completo vai para o diário (auditoria_diario). Um sinal que não sai deixa
        # rastro com o MOTIVO: sem a metade dos calados, nenhum filtro é auditável.
        audit = {
            "limiar_compra": req_buy,
            "limiar_venda": req_sell,
            "fator_regime": round(self.regime_meter.last_factor, 3),
            "efficiency_ratio": round(er, 4),
            "consolidacao": consolidating,
            "exaustao": exhausting,
            "absorcao": is_absorbed,
            "flow_score": flow_score,
            "flow_score_breakdown": score_breakdown,
            "sinal": None,
            "motivo": "SEM_DIRECAO",
        }
        signal, reason = None, ""

        if bool(cfg.get("anti_absorption_enabled", True)) and is_absorbed:
            audit["motivo"] = f"CALADO_ABSORCAO | Box {direction} com Δ {delta} oposto ao fechamento"
            box["audit"] = audit
            return None, ""

        if pyramid:
            if direction == "UP":
                # 1. Delta institucional: abaixo do limiar não existe sinal, seja qual for o regime
                if delta < req_buy:
                    audit["motivo"] = f"CALADO_DELTA | Δ {delta} < limiar {req_buy}"
                elif not divergence_ok:
                    audit["motivo"] = f"CALADO_DIVERGENCIA | div {divergence:.2f} < {div_min}"
                # 2. Regime: verde dentro de range curto ou fluxo exausto não é confluência
                elif regime_block:
                    audit["motivo"] = self._motivo_regime(consolidating, er, box, previous_boxes, cfg)
                else:
                    signal = "BUY"
                    reason = f"Pirâmide Confluência Alta: Bloco Verde #{box['index']} [Score {flow_score}/10] (Δ {delta} vs limiar {req_buy}{factor_lbl})"
                    audit["motivo"] = f"SINAL_BUY | Score {flow_score}/10 | Δ {delta} >= {req_buy}"
            elif direction == "DOWN":
                if delta > -req_sell:
                    audit["motivo"] = f"CALADO_DELTA | Δ {delta} > limiar {-req_sell}"
                elif not divergence_ok:
                    audit["motivo"] = f"CALADO_DIVERGENCIA | div {divergence:.2f} < {div_min}"
                elif regime_block:
                    audit["motivo"] = self._motivo_regime(consolidating, er, box, previous_boxes, cfg)
                else:
                    signal = "SELL"
                    reason = f"Pirâmide Confluência Baixa: Bloco Vermelho #{box['index']} [Score {flow_score}/10] (Δ {delta} vs limiar {-req_sell}{factor_lbl})"
                    audit["motivo"] = f"SINAL_SELL | Score {flow_score}/10 | Δ {delta} <= {-req_sell}"
        else:
            limite = limit_buy if direction == "UP" else limit_sell
            cruzou = (direction == "UP" and delta >= limit_buy) or (direction == "DOWN" and delta <= -limit_sell)
            if cruzou:
                cvd_ok = True
                if cfg["require_cvd_extreme"] and len(previous_boxes) >= 3:
                    recent = previous_boxes[-3:]
                    if direction == "UP":
                        cvd_ok = box["cvd_at_close"] >= max(b["cvd_at_close"] for b in recent)
                    else:
                        cvd_ok = box["cvd_at_close"] <= min(b["cvd_at_close"] for b in recent)
                if not cvd_ok:
                    audit["motivo"] = "CALADO_CVD | CVD não fez novo extremo"
                elif regime_block:
                    audit["motivo"] = self._motivo_regime(consolidating, er, box, previous_boxes, cfg)
                else:
                    signal = "BUY" if direction == "UP" else "SELL"
                    if signal == "BUY":
                        reason = f"Convergência COMPRA: Box 10R Alta + Delta +{delta} ctros (limiar {limit_buy}{factor_lbl})"
                    else:
                        reason = f"Convergência VENDA: Box 10R Baixa + Delta {delta} ctros (limiar {-limit_sell}{factor_lbl})"
                    audit["motivo"] = f"SINAL_{signal} | Δ {delta} vs limiar {limite}"
            elif direction in ("UP", "DOWN"):
                audit["motivo"] = f"CALADO_DELTA | Δ {delta} fora do limiar {limite}"

        audit["sinal"] = signal
        box["audit"] = audit
        return signal, reason


    def _motivo_regime(self, consolidating, er, box, previous_boxes, cfg):
        """Texto do corte por regime, para a coluna `motivo` do diário."""
        if consolidating:
            return (
                f"CALADO_ACUMULACAO | ER {er:.2f} < {cfg['consolidation_er_max']} "
                f"na janela de {cfg['consolidation_lookback']} boxes"
            )
        d = box.get("delta", 0) or 0
        for prev in reversed(previous_boxes):
            pd = prev.get("delta", 0) or 0
            if pd != 0 and (pd > 0) == (d > 0):
                return (
                    f"CALADO_EXAUSTAO | Δ {d} <= {cfg['exhaustion_ratio']}x do box "
                    f"#{prev.get('index')} (Δ {pd})"
                )
        return "CALADO_EXAUSTAO"





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

        modes = getattr(sym_info, 'filling_mode', 0)
        # MT5 C++ flags: 1 = FOK, 2 = IOC
        if modes & 2:
            return mt5.ORDER_FILLING_IOC
        elif modes & 1:
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



    def get_daily_pnl(self):
        """Calcula o PnL diário consolidado (fechado + aberto) do robô pelo seu magic_number."""
        now = datetime.now()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        realized_pnl = 0.0
        with MT5_LOCK:
            deals = mt5.history_deals_get(start_of_day, now)
            if deals:
                for d in deals:
                    if int(d.magic) == self.magic_number and d.symbol == self.symbol:
                        if d.entry == mt5.DEAL_ENTRY_OUT or d.profit != 0.0:
                            realized_pnl += float(d.profit) + float(d.commission) + float(d.swap)

            floating_pnl = 0.0
            positions = mt5.positions_get(symbol=self.symbol)
            if positions:
                for p in positions:
                    if int(p.magic) == self.magic_number:
                        floating_pnl += float(p.profit)

        self.daily_pnl = round(realized_pnl + floating_pnl, 2)
        return self.daily_pnl

    def check_risk_limits(self):
        """Verifica se o robô atingiu o teto diário de perda ou meta de lucro."""
        spec = get_asset_spec(self.symbol)
        max_loss = float(spec.get("max_daily_loss", MAX_DAILY_LOSS))
        max_gain = float(spec.get("max_daily_profit", MAX_DAILY_PROFIT))
        current_pnl = self.get_daily_pnl()

        if current_pnl <= -max_loss:
            if not getattr(self, "is_loss_locked", False):
                self.is_loss_locked = True
                print(f"🛑 [TRAVA DE RISCO DIÁRIA [{self.symbol}]] Stop Loss Diário atingido! PnL={current_pnl:.2f} <= -{max_loss:.2f}. Zerando posições!", flush=True)
                self.close_all_positions()
            return False, f"STOP_DIARIO_ATINGIDO (PnL R$ {current_pnl:.2f})"

        if current_pnl >= max_gain:
            if not getattr(self, "is_gain_locked", False):
                self.is_gain_locked = True
                print(f"🎉 [TRAVA DE GANHO DIÁRIA [{self.symbol}]] Meta de Lucro atingida! PnL={current_pnl:.2f} >= +{max_gain:.2f}. Protegendo capital!", flush=True)
            return False, f"META_DIARIA_BATIDA (PnL R$ {current_pnl:.2f})"

        return True, "OK"

    def update_trailing_stop_box(self, box):
        """Trailing Stop Caixa a Caixa: move o Stop Loss a cada box fechado a favor da tendência."""
        spec = get_asset_spec(self.symbol)
        if not spec.get("trailing_stop_enabled", True) and not TRAILING_STOP:
            return False

        sym_info = mt5.symbol_info(self.symbol)
        if not sym_info:
            return False

        tick_size = sym_info.trade_tick_size if sym_info.trade_tick_size > 0 else 1.0
        digits = sym_info.digits
        box_dir = box.get("direction")
        box_open = float(box.get("open", 0.0))
        box_close = float(box.get("close", 0.0))

        positions = mt5.positions_get(symbol=self.symbol)
        active_positions = [p for p in (positions or []) if p.magic == self.magic_number]
        if not active_positions:
            return False

        updated_any = False
        for pos in active_positions:
            is_buy = pos.type == mt5.ORDER_TYPE_BUY
            current_sl = float(pos.sl) if pos.sl else 0.0

            if is_buy and box_dir == "UP":
                raw_sl = box_open - tick_size
                candidate_sl = round(round(raw_sl / tick_size) * tick_size, digits)
                if candidate_sl > current_sl and candidate_sl < box_close:
                    print(f"📈 [TRAILING STOP [{self.symbol}]] Elevando SL da posição #{pos.ticket} de {current_sl} para {candidate_sl} (Box #{box['index']})", flush=True)
                    self.modify_stop_loss(pos.ticket, candidate_sl)
                    updated_any = True

            elif not is_buy and box_dir == "DOWN":
                raw_sl = box_open + tick_size
                candidate_sl = round(round(raw_sl / tick_size) * tick_size, digits)
                if (current_sl == 0.0 or candidate_sl < current_sl) and candidate_sl > box_close:
                    print(f"📉 [TRAILING STOP [{self.symbol}]] Descendo SL da posição #{pos.ticket} de {current_sl} para {candidate_sl} (Box #{box['index']})", flush=True)
                    self.modify_stop_loss(pos.ticket, candidate_sl)
                    updated_any = True

        return updated_any

    def check_schedule(self, tick_time_msc=None):
        if REPLAY_MODE:
            # Em modo replay, respeita a hora da fita se informada
            if tick_time_msc is not None and tick_time_msc > 0:
                tape_hm = datetime.fromtimestamp(tick_time_msc / 1000).strftime("%H:%M")
                if TRADING_HOURS_ENABLED:
                    if tape_hm >= CLOSE_ALL_TIME:
                        return False, True
                    if tape_hm < START_TIME or tape_hm >= STOP_ENTRIES_TIME:
                        return False, False
            return True, False

        # Se não foi fornecido tick_time_msc, tenta o último timestamp registrado da fita para o ativo
        if tick_time_msc is None:
            tick_time_msc = LAST_TAPE_TIME_MSC.get(self.symbol)

        if TRADING_HOURS_ENABLED:
            if tick_time_msc and tick_time_msc > 0:
                now_hm = datetime.fromtimestamp(tick_time_msc / 1000).strftime("%H:%M")
            else:
                now_hm = datetime.now().strftime("%H:%M")

            if now_hm >= CLOSE_ALL_TIME:
                if not getattr(self, "day_close_executed", False):
                    self.day_close_executed = True
                    print(f"🛑 [HORÁRIO B3] Fim de pregão atingido ({now_hm} >= {CLOSE_ALL_TIME}). Zerando posições...", flush=True)
                    self.close_all_positions()
                return False, True
            else:
                self.day_close_executed = False

            if now_hm < START_TIME or now_hm >= STOP_ENTRIES_TIME:
                return False, False

        can_trade_risk, risk_reason = self.check_risk_limits()
        if not can_trade_risk:
            print(f"🛑 [TRAVA DE RISCO [{self.symbol}]] Entrada bloqueada: {risk_reason}", flush=True)
            return False, False

        return True, False



    def place_pullback_limit_order(self, signal, box, comment="", tick_time_msc=None):

        can_trade, _ = self.check_schedule(tick_time_msc=tick_time_msc)

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



    def place_pyramid_limit_order(self, signal, box, comment="", volume=None, sl_points=0, tp_points=0, tick_time_msc=None):

        can_trade, _ = self.check_schedule(tick_time_msc=tick_time_msc)

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



        order_tag = str(comment or "FLOW")[:24]

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



    def place_websocket_limit_order(self, signal, limit_price, comment="", volume=None, sl_points=0, tp_points=0, magic=None, tick_time_msc=None):

        can_trade, _ = self.check_schedule(tick_time_msc=tick_time_msc)

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
        if not sym_info:
            return False

        tick_size = sym_info.trade_tick_size if (sym_info and sym_info.trade_tick_size > 0) else 1.0
        digits = sym_info.digits if sym_info else 0
        spec = get_asset_spec(self.symbol)
        offset_ticks = spec.get("breakeven_offset_ticks", 1)
        offset = offset_ticks * tick_size

        positions = mt5.positions_get(symbol=self.symbol)
        if not positions:
            return False

        active_same_dir = [
            p for p in positions
            if p.magic == self.magic_number and (
                (direction == "BUY" and p.type == mt5.ORDER_TYPE_BUY) or
                (direction == "SELL" and p.type == mt5.ORDER_TYPE_SELL)
            )
        ]
        if not active_same_dir:
            return False

        # Identifica a ordem mãe (marcada com 'MAE' ou a mais antiga na direção)
        main_candidates = [p for p in active_same_dir if "MAE" in (p.comment or "")]
        target_pos = main_candidates[0] if main_candidates else sorted(active_same_dir, key=lambda x: x.time_msc)[0]

        raw_be = (target_pos.price_open + offset) if direction == "BUY" else (target_pos.price_open - offset)
        be_sl = round(round(raw_be / tick_size) * tick_size, digits)

        current_sl = float(target_pos.sl) if target_pos.sl else 0.0
        improves = (current_sl <= 0.0) or (be_sl > current_sl if direction == "BUY" else be_sl < current_sl)
        if not improves:
            return False

        print(f"🛡️ [BREAKEVEN AUTOMÁTICO [{self.symbol}]] Movendo SL da Ordem Mãe #{target_pos.ticket} de {current_sl} para {be_sl} (preço entrada={target_pos.price_open})", flush=True)
        return self.modify_stop_loss(target_pos.ticket, be_sl)

    def watch_closed_pyramids(self):
        if not MAIN_BREAKEVEN_ON_PYR_TP or not self.pyramid_tickets:
            return

        positions = mt5.positions_get(symbol=self.symbol)
        open_tickets = set(p.ticket for p in (positions or []) if p.magic == self.magic_number)

        for ticket in list(self.pyramid_tickets.keys()):
            if ticket in open_tickets:
                continue

            direction = self.pyramid_tickets.pop(ticket)
            print(f"🎯 [TP/FECHAMENTO PIRÂMIDE #{ticket} {direction} [{self.symbol}]] Movendo ordem mãe para o breakeven...", flush=True)
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



    def _audit_ordem(self, acao="MERCADO", direcao="", volume=None, preco_box=None, preco_solicitado=None,
                     preco_fill=None, ticket=None, retcode=None, executada=False, motivo="",
                     box_index="", sl_points=None, tp_points=None):
        """Registra a tentativa no diário SEMPRE, inclusive quando nada é enviado.

        Existiu um pregão inteiro em que o console dizia "[ABRINDO ORDEM MÃE]" e nenhuma ordem
        saía (AttributeError no caminho do filling). Print de tentativa não é prova de execução;
        esta linha de CSV é. O método nunca levanta exceção para não derrubar a operação.
        """
        if not AUDITORIA_ENABLED:
            return
        try:
            audit_registrar_ordem(
                self.symbol, acao, direcao=direcao or "",
                volume=self.contracts if volume is None else volume,
                preco_box=preco_box, preco_solicitado=preco_solicitado, preco_fill=preco_fill,
                ticket=ticket, retcode=retcode, executada=executada, sl_pontos=sl_points,
                tp_pontos=tp_points, motivo=motivo, box_index=box_index,
            )
        except Exception as exc:
            print(f"[AVISO] falha ao gravar diário de ordens: {exc}", flush=True)


    def execute_market_order(self, order_type, comment="", volume=None, sl_points=None, tp_points=None, magic=None,
                             box_index="", preco_box=None, acao="MERCADO", tick_time_msc=None):

        can_trade, _ = self.check_schedule(tick_time_msc=tick_time_msc)

        if not can_trade:

            self._audit_ordem(acao, order_type, volume, preco_box, None, None, None, None, False,
                              "BLOQUEADO_POR_HORARIO", box_index, sl_points, tp_points)

            return False, 0



        mt5.symbol_select(self.symbol, True)
        sym_info = mt5.symbol_info(self.symbol)
        if not sym_info:
            print(f"[ERRO MT5] Símbolo {self.symbol} não encontrado no MT5!", flush=True)
            return False, 0

        tick_size = sym_info.trade_tick_size if sym_info.trade_tick_size > 0 else 1.0
        digits = sym_info.digits

        tick = mt5.symbol_info_tick(self.symbol)
        if not tick:
            self._audit_ordem(acao, order_type, volume, preco_box, None, None, None, None, False,
                              "SEM_TICK_DA_CORRETORA", box_index, sl_points, tp_points)
            print(f"[ERRO MT5] Sem tick disponível para {self.symbol}!", flush=True)
            return False, 0

        use_volume = float(volume) if volume is not None else float(self.contracts)
        is_buy = order_type == "BUY"
        entry_price = tick.ask if is_buy else tick.bid

        spec = get_asset_spec(self.symbol)

        # Proteção contra spread excessivo (evita slippage em momentos de book furado)
        max_spread_pts = spec.get("max_spread_ticks", 4) * tick_size
        current_spread = abs(tick.ask - tick.bid)
        if current_spread > max_spread_pts:
            msg_spread = f"SPREAD_EXCESSIVO | spread={current_spread:.1f} > max={max_spread_pts:.1f}"
            print(f"🛑 [TRAVA DE SPREAD [{self.symbol}]] Ordem cancelada: spread {current_spread:.1f} pts > teto de {max_spread_pts:.1f} pts", flush=True)
            self._audit_ordem(acao, order_type, use_volume, preco_box, entry_price, None, None, None, False,
                              msg_spread, box_index, sl_points, tp_points)
            return False, 0

        default_sl = spec.get("sl_points", STOP_LOSS_POINTS)
        default_tp = spec.get("tp_points", TAKE_PROFIT_POINTS)
        sl_val = float(sl_points) if sl_points is not None else float(default_sl)
        if sl_val > 0:
            raw_sl = (entry_price - sl_val) if is_buy else (entry_price + sl_val)
            sl_price = round(round(raw_sl / tick_size) * tick_size, digits)
        else:
            sl_price = 0.0

        tp_val = float(tp_points) if tp_points is not None else float(default_tp)
        if tp_val > 0:
            raw_tp = (entry_price + tp_val) if is_buy else (entry_price - tp_val)
            tp_price = round(round(raw_tp / tick_size) * tick_size, digits)
        else:
            tp_price = 0.0

        order_tag = str(comment or "FLOW")[:24]

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

        print(f" 🚀 ENVIANDO ORDEM AO MT5: {self.symbol} {order_type} {use_volume} ctros @ {entry_price} | SL={sl_price} TP={tp_price} Magic={request['magic']}", flush=True)
        res = mt5.order_send(request)

        if res is None:
            err_code, err_desc = mt5.last_error()
            print(f"❌ [ERRO MT5 CRÍTICO [{self.symbol}]] order_send retornou None! Erro={err_code} ({err_desc}) | Request: {request}", flush=True)
            return False, 0

        if res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"✅ ORDEM EXECUTADA: {self.symbol} {order_type} {use_volume} ctros @ {entry_price} | Ticket #{res.order}", flush=True)
            self._audit_ordem(acao, order_type, use_volume, preco_box, entry_price, entry_price,
                              res.order, res.retcode, True, "ORDEM_ACCEPTED", box_index, sl_val, tp_val)
            return True, res.order
        else:
            print(f"❌ [ERRO MT5 [{self.symbol}]] RetCode={res.retcode}, Desc={res.comment} | Request: {request}", flush=True)
            self._audit_ordem(acao, order_type, use_volume, preco_box, entry_price, None, None,
                              getattr(res, "retcode", None), False, f"REJEITADO_CORRETORA | {getattr(res, 'comment', '')}",
                              box_index, sl_val, tp_val)
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
            print(f"\n🔄 [INVERSÃO DE FLUXO DETECTADA [{self.symbol}]] Zerando posições antigas (magic {self.magic_number}) para virar para {current_dir}!", flush=True)
            self.close_all_positions()
            time.sleep(0.05)
            active_positions = []

        spec = get_asset_spec(self.symbol)
        base_vol = spec.get("contracts", MAIN_CONTRACTS)
        pyr_vol = spec.get("pyramid_contracts", PYRAMID_CONTRACTS)
        pyr_sl = spec.get("pyramid_sl_points", PYRAMID_SL_POINTS)
        pyr_tp = spec.get("pyramid_tp_points", PYRAMID_TP_POINTS)
        max_pyr = spec.get("max_pyramids", 3)

        # Dimensionamento Dinâmico de Lotes por Score de Convicção Institucional (Item 4)
        flow_score = box.get("flow_score", 5) if isinstance(box, dict) else 5
        if flow_score >= 8:
            # Score 8 a 10 (Alta Convicção / Super Confluência): Lote Turbo
            main_vol = max(base_vol, 3) if "WIN" in self.symbol.upper() else max(base_vol, 2)
            score_tier = f"TURBO (Score {flow_score}/10)"
        elif flow_score >= 5:
            # Score 5 a 7 (Convicção Padrão): Lote Calibrado
            main_vol = base_vol
            score_tier = f"PADRAO (Score {flow_score}/10)"
        else:
            # Score 1 a 4 (Convicção Baixa / Raspando Limiar): Lote Mínimo Conservador (1 contrato)
            main_vol = 1
            score_tier = f"CONSERVADOR (Score {flow_score}/10)"

        has_main_order = False
        pyramid_count = 0
        for pos in active_positions:
            comment_str = str(pos.comment or "")
            if "MAE" in comment_str:
                has_main_order = True
            elif "PIR" in comment_str:
                pyramid_count += 1

        if not has_main_order and not active_positions:
            sl_pts = spec.get("sl_points", 0)
            tp_pts = spec.get("tp_points", 0)

            if PYRAMID_ENTRY_TYPE != "MARKET_ON_CLOSE":
                success, ticket, placed = self.place_pyramid_limit_order(
                    current_dir,
                    box,
                    comment=f"MAE_{box['index']}_S{flow_score}",
                    volume=main_vol,
                    sl_points=sl_pts,
                    tp_points=tp_pts
                )
                if success:
                    self.main_tickets[ticket] = current_dir
                return success, ticket, "MAIN"

            print(f"🟢 [ABRINDO ORDEM MÃE [{self.symbol}]] {current_dir} {main_vol} ctro(s) [{score_tier}] no Box #{box['index']}", flush=True)
            try:
                success, ticket = self.execute_market_order(
                    order_type=current_dir,
                    comment=f"MAE_{box['index']}_S{flow_score}",
                    volume=main_vol,
                    sl_points=sl_pts,
                    tp_points=tp_pts,
                    box_index=box["index"],
                    preco_box=box["close"],
                    acao=f"ORDEM_MAE_S{flow_score}",
                )
            except Exception as exc:
                self._audit_ordem("ORDEM_MAE", current_dir, main_vol, box["close"], None, None,
                                  None, None, False,
                                  f"EXCECAO_ANTES_DO_SEND | {type(exc).__name__}: {exc}", box["index"], 0, 0)
                print(f"❌ [ORDEM ABORTADA ANTES DO ENVIO [{self.symbol}]] {type(exc).__name__}: {exc}", flush=True)
                return False, 0, "MAIN"

            if success:
                self.main_tickets[ticket] = current_dir
            return success, ticket, "MAIN"

        else:
            if pyramid_count >= max_pyr:
                print(f"⚠️ [LIMITE PIRÂMIDE [{self.symbol}]] Já existem {pyramid_count} pirâmides ativas (teto = {max_pyr}). Adição ignorada.", flush=True)
                return False, 0, "MAX_PYRAMIDS_REACHED"

            pyramid_num = pyramid_count + 1
            print(f"🪜 [PIRAMIDAÇÃO #{pyramid_num} [{self.symbol}]] Adicionando {pyr_vol} ctro(s) a favor de {current_dir} no Box #{box['index']}", flush=True)

            if PYRAMID_ENTRY_TYPE != "MARKET_ON_CLOSE":
                success, ticket, placed = self.place_pyramid_limit_order(
                    current_dir,
                    box,
                    comment=f"PIR_{pyramid_num}_{box['index']}",
                    volume=pyr_vol,
                    sl_points=pyr_sl,
                    tp_points=pyr_tp
                )
                if success:
                    self.pyramid_tickets[ticket] = current_dir
                    self.move_main_to_breakeven(current_dir)
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
        sym_info = mt5.symbol_info(self.symbol)
        if not sym_info:
            return True

        # Se a negociação estiver desativada na B3/corretora (fim de pregão), evita enviar ordem a mercado
        # para que o MetaTrader 5 não fique emitindo som de rejeição de ordem ("bufando")
        if sym_info.trade_mode == mt5.SYMBOL_TRADE_MODE_DISABLED:
            print(f"⚠️ [MERCADO FECHADO [{self.symbol}]] Negociação desativada pela corretora (trade_mode=DISABLED). Zeragem evitada no MT5.", flush=True)
            return True

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

            close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY

            tick = mt5.symbol_info_tick(self.symbol)
            if not tick:
                continue

            price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask
            if not price or price <= 0:
                continue

            closed_n += 1

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

            res = mt5.order_send(req)
            if res and res.retcode != mt5.TRADE_RETCODE_DONE:
                print(f"⚠️ [MT5 AVISO [{self.symbol}]] RetCode={res.retcode} ({res.comment}) ao zerar #{pos.ticket}", flush=True)

        alvo = f"lado {side}" if side_type is not None else "posições"

        donos = f"magic {magic_filter}" if magic_filter is not None else "TODOS os magics"

        print(f"🛑 {alvo} zeradas a mercado ({closed_n} posição(ões), {donos}) | PnL aproximado: R$ {pnl_brl:.2f}.")

        return True





class MT5VaralManager:
    """
    ROBÔ 2: VARAL DE ORDENS (SOMBRA REAL NO MT5)
    Executa ordens pendentes escalonadas para frente quando aparece sinal ('C' ou 'V') na tela:
    - Se aparece 'C': pendura ordens BUY_STOP 50 pts pra frente (até max_orders).
    - Se aparece 'V': pendura ordens SELL_STOP 50 pts pra baixo (até max_orders).
    - Virou a direção: cancela ordens pendentes do lado oposto e zera posições anteriores.
    - Magic Numbers independentes (150102 / 150202 / 150302).
    - Não interfere nas posições nem na gestão do Robô Mestre (150x01).
    """
    def __init__(self, symbol):
        self.symbol = symbol
        self.asset_key = "WIN" if "WIN" in symbol else ("WDO" if "WDO" in symbol else ("BIT" if "BIT" in symbol else "WIN"))
        self.cfg = dict(VARAL_CONFIG.get(self.asset_key, VARAL_CONFIG["WIN"]))
        self.magic = self.cfg["magic"]
        self.last_signal_dir = None
        self.placed_orders_count = 0

    def get_filling_mode(self):
        sym_info = mt5.symbol_info(self.symbol)
        if not sym_info:
            return mt5.ORDER_FILLING_IOC
        fill_flags = sym_info.filling_mode
        if fill_flags & 2:
            return mt5.ORDER_FILLING_RETURN
        if fill_flags & 1:
            return mt5.ORDER_FILLING_IOC
        return mt5.ORDER_FILLING_RETURN

    def update_config(self, patch):
        for k, v in patch.items():
            if k in self.cfg:
                self.cfg[k] = v
        # Sincroniza de volta no dict global
        VARAL_CONFIG[self.asset_key].update(self.cfg)
        print(f"🧺 [VARAL {self.symbol}] Config atualizada: max_orders={self.cfg['max_orders']}, tp={self.cfg['tp_points']} pts, step={self.cfg['step_points']} pts, enabled={self.cfg['enabled']}", flush=True)

    def cancel_pending_orders(self):
        """Cancela todas as ordens pendentes do Varal no MT5."""
        with MT5_LOCK:
            orders = mt5.orders_get(symbol=self.symbol)
        if not orders:
            return
        for o in orders:
            if o.magic == self.magic:
                req = {
                    "action": mt5.TRADE_ACTION_REMOVE,
                    "order": o.ticket,
                    "magic": self.magic,
                    "symbol": self.symbol,
                }
                with MT5_LOCK:
                    res = mt5.order_send(req)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    print(f"🗑️ [VARAL {self.symbol}] Ordem pendente #{o.ticket} cancelada", flush=True)

    def close_all_positions(self):
        """Zera posições abertas pertencentes exclusivamente ao Magic do Varal."""
        sym_info = mt5.symbol_info(self.symbol)
        if not sym_info or sym_info.trade_mode == mt5.SYMBOL_TRADE_MODE_DISABLED:
            return
        with MT5_LOCK:
            positions = mt5.positions_get(symbol=self.symbol)
        if not positions:
            return
        for pos in positions:
            if pos.magic == self.magic:
                is_buy = pos.type == mt5.ORDER_TYPE_BUY
                close_type = mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY
                close_price = sym_info.bid if is_buy else sym_info.ask
                if not close_price or close_price <= 0:
                    continue
                req = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "position": pos.ticket,
                    "symbol": self.symbol,
                    "volume": float(pos.volume),
                    "type": close_type,
                    "price": float(close_price),
                    "deviation": 20,
                    "magic": self.magic,
                    "comment": f"FLIP_VARAL_{pos.ticket}"[:31],
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": self.get_filling_mode(),
                }
                with MT5_LOCK:
                    res = mt5.order_send(req)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    print(f"🔄 [VARAL {self.symbol}] Posição #{pos.ticket} zerada por virada de sinal", flush=True)

    def on_box_signal(self, signal, box_price, tick_time_msc=None):
        """
        Gatilho do Varal acionado por sinal de box ('BUY' / 'SELL' ou 'C' / 'V').
        """
        if not self.cfg.get("enabled", True):
            return

        if tick_time_msc is None:
            tick_time_msc = LAST_TAPE_TIME_MSC.get(self.symbol)

        if TRADING_HOURS_ENABLED:
            if tick_time_msc and tick_time_msc > 0:
                now_hm = datetime.fromtimestamp(tick_time_msc / 1000).strftime("%H:%M")
            elif not REPLAY_MODE:
                now_hm = datetime.now().strftime("%H:%M")
            else:
                now_hm = None

            if now_hm and (now_hm >= CLOSE_ALL_TIME or now_hm < START_TIME):
                return

        is_buy = signal in ("BUY", "C", "UP")
        direction = "BUY" if is_buy else "SELL"

        # Se virou a direção do sinal: cancela pendentes do lado oposto e zera posições
        if self.last_signal_dir and self.last_signal_dir != direction:
            print(f"\n🧺 [VARAL {self.symbol}] Virada de sinal detectada ({self.last_signal_dir} -> {direction})! Limpando varal anterior...", flush=True)
            self.cancel_pending_orders()
            self.close_all_positions()
            self.placed_orders_count = 0

        self.last_signal_dir = direction

        # Quantas ordens/posições ativas do varal já existem?
        with MT5_LOCK:
            positions = [p for p in (mt5.positions_get(symbol=self.symbol) or []) if p.magic == self.magic]
            pending = [o for o in (mt5.orders_get(symbol=self.symbol) or []) if o.magic == self.magic]

        total_active = len(positions) + len(pending)
        max_orders = int(self.cfg.get("max_orders", 3))

        if total_active >= max_orders:
            # Varal já atingiu o teto de ordens penduradas
            return

        # Próxima ordem do varal
        order_index = total_active + 1
        step_pts = float(self.cfg.get("step_points", 50.0))
        tp_pts = float(self.cfg.get("tp_points", 50.0))
        sl_pts = float(self.cfg.get("sl_points", 50.0))
        contracts = float(self.cfg.get("contracts", 1.0))

        sym_info = mt5.symbol_info(self.symbol)
        if not sym_info:
            return
        tick_size = sym_info.trade_tick_size if sym_info.trade_tick_size > 0 else 1.0
        curr_ask = sym_info.ask
        curr_bid = sym_info.bid

        execution_type = str(self.cfg.get("execution_type", "MARKET")).upper()

        # =====================================================================
        # MODO A MERCADO: Executa imediatamente no fechamento de cada bloco (C ou V)
        # =====================================================================
        if execution_type == "MARKET":
            order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
            exec_price = curr_ask if is_buy else curr_bid
            if is_buy:
                ref_sl = min(curr_bid, exec_price)
                sl_price = round((ref_sl - max(sl_pts, tick_size)) / tick_size) * tick_size if sl_pts > 0 else 0.0
                tp_price = round((exec_price + tp_pts) / tick_size) * tick_size if tp_pts > 0 else 0.0
            else:
                ref_sl = max(curr_ask, exec_price)
                sl_price = round((ref_sl + max(sl_pts, tick_size)) / tick_size) * tick_size if sl_pts > 0 else 0.0
                tp_price = round((exec_price - tp_pts) / tick_size) * tick_size if tp_pts > 0 else 0.0

            comment = f"VARAL_MKT_{'C' if is_buy else 'V'}{order_index}"
            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": self.symbol,
                "volume": contracts,
                "type": order_type,
                "price": float(exec_price),
                "sl": float(sl_price),
                "tp": float(tp_price),
                "deviation": 20,
                "magic": self.magic,
                "comment": comment,
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": self.get_filling_mode(),
            }

            with MT5_LOCK:
                res = mt5.order_send(req)

            if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                print(f"⚡ [VARAL A MERCADO {self.symbol} #{order_index}/{max_orders}] Ordem a mercado aberta: {direction} {contracts}ct @ {exec_price} | TP={tp_price} SL={sl_price} (Ticket #{res.order})", flush=True)
                self.placed_orders_count += 1
            else:
                err = getattr(res, "comment", "Desconhecido")
                print(f"⚠️ [VARAL A MERCADO {self.symbol}] Falha ao executar: {err} | Request: {req}", flush=True)
            return

        # =====================================================================
        # MODO LIMITE / PENDENTE: Pendura ordem no book à frente (step_pts)
        # =====================================================================
        if is_buy:
            ref_p = curr_ask
            target_p = ref_p + (step_pts * (len(pending) + 1))
            target_p = round(target_p / tick_size) * tick_size
            order_type = mt5.ORDER_TYPE_BUY_STOP if target_p > curr_ask else mt5.ORDER_TYPE_BUY_LIMIT
            sl_price = round((target_p - sl_pts) / tick_size) * tick_size if sl_pts > 0 else 0.0
            tp_price = round((target_p + tp_pts) / tick_size) * tick_size if tp_pts > 0 else 0.0
        else:
            ref_p = curr_bid
            target_p = ref_p - (step_pts * (len(pending) + 1))
            target_p = round(target_p / tick_size) * tick_size
            order_type = mt5.ORDER_TYPE_SELL_STOP if target_p < curr_bid else mt5.ORDER_TYPE_SELL_LIMIT
            sl_price = round((target_p + sl_pts) / tick_size) * tick_size if sl_pts > 0 else 0.0
            tp_price = round((target_p - tp_pts) / tick_size) * tick_size if tp_pts > 0 else 0.0

        comment = f"VARAL_{'C' if is_buy else 'V'}{order_index}"
        req = {
            "action": mt5.TRADE_ACTION_PENDING,
            "symbol": self.symbol,
            "volume": contracts,
            "type": order_type,
            "price": float(target_p),
            "sl": float(sl_price),
            "tp": float(tp_price),
            "deviation": 20,
            "magic": self.magic,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": self.get_filling_mode(),
        }

        with MT5_LOCK:
            res = mt5.order_send(req)

        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            print(f"🧺 [VARAL LIMITE {self.symbol} #{order_index}/{max_orders}] Ordem pendente enviada: {direction} {contracts}ct @ {target_p} | TP={tp_price} SL={sl_price} (Ticket #{res.order})", flush=True)
            self.placed_orders_count += 1
        else:
            err = getattr(res, "comment", "Desconhecido")
            print(f"⚠️ [VARAL LIMITE {self.symbol}] Falha ao pendurar degrau #{order_index}: {err} | Request: {req}", flush=True)


CONNECTED_CLIENTS = set()

ORDER_MANAGER = None

ENGINES = {}
ORDER_MANAGERS = {}
VARAL_MANAGERS = {}

def get_or_create_varal_manager(sym):
    if sym in VARAL_MANAGERS:
        return VARAL_MANAGERS[sym]
    vmgr = MT5VaralManager(sym)
    VARAL_MANAGERS[sym] = vmgr
    return vmgr

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

def apply_ea_config(payload):
    """Aplica na ponte a config de avaliação que está ligada na tela (SYNC_EA_CONFIG).

    Muda apenas o JULGAMENTO do sinal — nenhum campo daqui dispara ordem. O que não vier no
    payload mantém o valor anterior, para um app mais antigo não zerar os filtros por
    acidente ao conectar.
    """
    changed = []

    def _bool(key, target):
        if key in payload:
            val = bool(payload[key])
            if EVAL_CONFIG[target] != val:
                EVAL_CONFIG[target] = val
                changed.append(f"{target}={val}")

    def _num(key, target, cast):
        if key in payload and payload[key] is not None:
            try:
                val = cast(payload[key])
            except (TypeError, ValueError):
                return
            if val != EVAL_CONFIG[target]:
                EVAL_CONFIG[target] = val
                changed.append(f"{target}={val}")

    if payload.get("strategyMode"):
        mode = str(payload["strategyMode"])
        if mode != EVAL_CONFIG["strategy_mode"]:
            EVAL_CONFIG["strategy_mode"] = mode
            changed.append(f"strategy_mode={mode}")

    _bool("adaptiveThresholdEnabled", "adaptive")
    _bool("consolidationFilterEnabled", "consolidation_enabled")
    _bool("exhaustionFilterEnabled", "exhaustion_enabled")
    _bool("requireCvdNewExtreme", "require_cvd_extreme")
    _num("regimeLookbackBoxes", "regime_lookback", int)
    _num("consolidationLookbackBoxes", "consolidation_lookback", int)
    _num("consolidationErMax", "consolidation_er_max", float)
    _num("exhaustionDeltaRatio", "exhaustion_ratio", float)
    _num("sessionPercentile", "percentile", float)
    _num("adaptiveThresholdPercentile", "percentile", float)
    _num("adaptiveFloorMultiple", "floor_multiple", float)
    _num("flowDivergenceMin", "flow_divergence_min", float)

    # Propaga o lookback de boxes para todos os motores de regime ativos
    if "regime_lookback" in EVAL_CONFIG:
        new_lb = EVAL_CONFIG["regime_lookback"]
        for eng in ENGINES.values():
            if hasattr(eng, "regime_meter") and hasattr(eng.regime_meter, "set_lookback"):
                eng.regime_meter.set_lookback(new_lb)

    # A base de Delta é calibrada por ativo (cada mercado tem outra liquidez por tijolo),
    # então o número global da tela só se aplica ao ativo que está no gráfico.
    sym = str(payload.get("symbol") or "").upper()
    if sym in ENGINES and payload.get("minDeltaThreshold") is not None:
        try:
            eng_min = int(payload["minDeltaThreshold"])
        except (TypeError, ValueError):
            eng_min = 0
        if eng_min > 0 and eng_min != ENGINES[sym].min_delta_threshold:
            ENGINES[sym].min_delta_threshold = eng_min
            changed.append(f"min_delta[{sym}]={eng_min}")

    if changed:
        print(" 🧠 REGRAS DO SINAL SINCRONIZADAS COM A TELA: " + ", ".join(changed), flush=True)
    return changed

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

                'price_open': float(p.price_open),

                'priceCurrent': float(p.price_current),

                'price_current': float(p.price_current),

                'profit': float(p.profit),

                'sl': float(p.sl),

                'tp': float(p.tp),

                'magic': int(p.magic),

                'comment': str(p.comment or '')

            })

        return positions_list



def fetch_mt5_orders():
    """Retorna a lista de ordens pendentes abertas no MT5 (incluindo o Varal de Ordens)."""
    with MT5_LOCK:
        ords = mt5.orders_get()
    if not ords:
        return []
    orders_list = []
    for o in ords:
        otype = 'BUY_STOP' if o.type == mt5.ORDER_TYPE_BUY_STOP else ('SELL_STOP' if o.type == mt5.ORDER_TYPE_SELL_STOP else ('BUY_LIMIT' if o.type == mt5.ORDER_TYPE_BUY_LIMIT else 'SELL_LIMIT'))
        orders_list.append({
            'ticket': int(o.ticket),
            'time': int(getattr(o, 'time_setup', 0)) * 1000,
            'symbol': str(o.symbol),
            'type': otype,
            'volume': float(o.volume_current),
            'price': float(o.price_open),
            'sl': float(o.sl),
            'tp': float(o.tp),
            'magic': int(o.magic),
            'comment': str(o.comment or '')
        })
    return orders_list



LAST_DAY_STATS_CACHE = None
LAST_DAY_STATS_TIME = 0.0

def fetch_mt5_day_stats(symbol=None):
    """Calcula estatísticas de contratos negociados e resultado financeiro realizado da sessão de hoje (com cache de 4s para estabilidade e fluidez)."""
    global LAST_DAY_STATS_CACHE, LAST_DAY_STATS_TIME
    now_ts = time.time()
    if LAST_DAY_STATS_CACHE and (now_ts - LAST_DAY_STATS_TIME < 4.0):
        sym_key = (symbol or SYMBOL)[:3].upper()
        res = dict(LAST_DAY_STATS_CACHE)
        res["current"] = res["bySymbol"].get(sym_key, res["global"])
        return res

    now = datetime.now()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    with MT5_LOCK:
        deals = mt5.history_deals_get(start_of_day, now) or []

    def _calc(sym_prefix=None):
        buy_vol = 0.0
        sell_vol = 0.0
        realized_pos = 0.0
        realized_neg = 0.0
        closed_cnt = 0
        for d in deals:
            if sym_prefix and not str(d.symbol).upper().startswith(sym_prefix.upper()):
                continue
            vol = float(d.volume)
            if d.type == mt5.DEAL_TYPE_BUY:
                buy_vol += vol
            elif d.type == mt5.DEAL_TYPE_SELL:
                sell_vol += vol
            if d.entry == mt5.DEAL_ENTRY_OUT or d.entry == mt5.DEAL_ENTRY_INOUT or d.profit != 0.0:
                pnl = float(d.profit) + float(d.commission) + float(d.swap)
                if pnl >= 0:
                    realized_pos += pnl
                else:
                    realized_neg += pnl
                closed_cnt += 1
        return {
            "buyContractsToday": buy_vol,
            "sellContractsToday": sell_vol,
            "totalContractsToday": buy_vol + sell_vol,
            "realizedProfit": round(realized_pos, 2),
            "realizedLoss": round(realized_neg, 2),
            "netRealized": round(realized_pos + realized_neg, 2),
            "dealsCount": closed_cnt
        }

    global_stats = _calc(None)
    by_symbol = {
        "WIN": _calc("WIN"),
        "WDO": _calc("WDO"),
        "BIT": _calc("BIT")
    }

    sym_key = (symbol or SYMBOL)[:3].upper()
    current_sym_stats = by_symbol.get(sym_key, global_stats)

    res = {
        "current": current_sym_stats,
        "global": global_stats,
        "bySymbol": by_symbol
    }
    LAST_DAY_STATS_CACHE = res
    LAST_DAY_STATS_TIME = now_ts
    return res


async def send_mt5_equity_data(websocket, limit=1000, days=30):

    with MT5_LOCK:

        acc = mt5.account_info()

    deals = await asyncio.to_thread(fetch_mt5_deals, limit, days)

    positions = await asyncio.to_thread(fetch_mt5_positions)

    day_stats_pack = await asyncio.to_thread(fetch_mt5_day_stats, SYMBOL)

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

            "positions": positions,

            "dayStats": day_stats_pack["current"],

            "dayStatsGlobal": day_stats_pack["global"],

            "dayStatsBySymbol": day_stats_pack["bySymbol"]

        }

    })



async def send_account_info(websocket):

    with MT5_LOCK:

        acc = mt5.account_info()

    state = client_state(websocket)

    deals = await asyncio.to_thread(fetch_mt5_deals, 500, 30)

    positions = await asyncio.to_thread(fetch_mt5_positions)

    orders = await asyncio.to_thread(fetch_mt5_orders)

    day_stats_pack = await asyncio.to_thread(fetch_mt5_day_stats, SYMBOL)

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

            "pendingOrders": orders,

            "varalConfig": VARAL_CONFIG,

            "dayStats": day_stats_pack["current"],

            "dayStatsGlobal": day_stats_pack["global"],

            "dayStatsBySymbol": day_stats_pack["bySymbol"],

            "entryTriggerType": ENTRY_TRIGGER_TYPE,

            "pullbackTarget": PULLBACK_TARGET,

            "partialExit": ENABLE_PARTIAL_EXIT,

            "trailingStop": TRAILING_STOP,

            "requireAuth": REQUIRE_AUTH,

            "ordersBlocked": ordens_bloqueadas(),

            "replayMode": REPLAY_MODE,

            "travaAmbiente": ORDERS_BLOCKED,

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
    """Envia os candles M1 das últimas sessões (hoje + BACKFILL_SESSIONS-1 anteriores)
    convertidos em ticks para popular o gráfico ao conectar.

    Cada tick leva o seu dia (`session`): é o que permite ao app marcar onde um pregão
    termina e o outro começa — com só o pregão de hoje na tela o gap de abertura é invisível."""
    global LAST_BACKFILL_CACHE
    raw_sym = str(target_symbol or SYMBOL).upper().strip()
    spec = get_asset_spec(raw_sym)

    # Resolve o símbolo físico do MT5 (ex: "WDO" -> "WDOZ26")
    sym = raw_sym
    with MT5_LOCK:
        s_info = mt5.symbol_info(sym)
        if not s_info:
            sym = spec.get("symbol", raw_sym)
            mt5.symbol_select(sym, True)
        else:
            mt5.symbol_select(sym, True)

    box_pts = float(spec.get("box_points", 2.5 if ("WDO" in sym or "DOL" in sym) else 50.0))
    now = time.time()

    cached = LAST_BACKFILL_CACHE.get(sym) or LAST_BACKFILL_CACHE.get(raw_sym)
    if cached and (now - cached["time"] < 45):
        await send_json(websocket, cached["payload"])
        print(f" 📊 Gráfico do dia ({sym} / box {box_pts} pts) enviado do CACHE para {get_peer_ip(websocket)}", flush=True)
        return

    def _safe_fetch_rates():
        with MT5_LOCK:
            # Uma sessão da B3 em M1 ≈ 480 barras; WDO/BIT passam de 600. Pede folga para
            # o terminal devolver todas as sessões pedidas, não só a metade delas.
            barras = max(1200, BACKFILL_SESSIONS * 800)
            return mt5.copy_rates_from_pos(sym, mt5.TIMEFRAME_M1, 0, barras)

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
        # Agrupa por dia de sessão e fica só com as últimas BACKFILL_SESSIONS sessões.
        # `time` do MT5 já é a hora do servidor (BRT gravado como epoch UTC).
        dias: list = []
        for r in rates:
            dia = datetime.fromtimestamp(int(r["time"]), timezone.utc).strftime("%Y-%m-%d")
            if dia not in dias:
                dias.append(dia)
        dias = dias[-BACKFILL_SESSIONS:]
        dias_set = set(dias)
        if not dias:
            print(f" ⚠️ [AVISO BACKFILL] MT5 sem sessões válidas para {sym}", flush=True)
            return
        selecionadas = [
            r for r in rates
            if datetime.fromtimestamp(int(r["time"]), timezone.utc).strftime("%Y-%m-%d") in dias_set
        ]
        last_day = dias[-1]
        dec = 1 if "WDO" in sym or "DOL" in sym else 0
        bf_ticks = []
        for r in selecionadas:
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
                    "session": datetime.fromtimestamp(int(r["time"]), timezone.utc).strftime("%Y-%m-%d"),
                })

        payload = {
            "type": "SESSION_BACKFILL",
            "symbol": sym,
            "data": {
                "ticks": bf_ticks,
                "bars": len(selecionadas),
                "sessions": dias,
                "date": last_day,
                "symbol": sym,
                "boxPoints": box_pts,
                "source": "MT5_M1_ESTIMATED"
            }
        }
        LAST_BACKFILL_CACHE[sym] = {"payload": payload, "time": now}
        LAST_BACKFILL_CACHE[raw_sym] = {"payload": payload, "time": now}
        await send_json(websocket, payload)
        print(
            f" 📊 Gráfico ({sym} / {box_pts} pts) {len(dias)} pregão(ões) {dias[0]}..{last_day}: "
            f"{len(selecionadas)} barras M1 ({len(bf_ticks)} ticks) para {get_peer_ip(websocket)}",
            flush=True,
        )

    except Exception as exc:
        print(f" ⚠️ [ERRO BACKFILL] Falha ao processar M1 de {sym}: {exc}", flush=True)

async def ws_handler(websocket):
    global SYMBOL, ASSET_LABEL, ASSET_DECIMALS, ASSET_TICK_SIZE, ASSET_POINT_VALUE, BOX_POINTS, LAST_BACKFILL_PAYLOAD
    global AUTH_TOKEN, ORDER_MANAGER, RENKO_ENGINE, LAST_TICK_TIMES, LAST_BACKFILL_CACHE
    global REPLAY_MODE

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
                is_local = peer in ("127.0.0.1", "::1", "localhost") or peer.startswith("192.168.") or peer.startswith("10.") or peer.startswith("172.")

                token_file_content = ""
                try:
                    token_file = Path(__file__).resolve().parent / "bridge_token.txt"
                    if token_file.is_file():
                        token_file_content = token_file.read_text(encoding="utf-8").strip()
                except Exception:
                    pass

                matches = False
                if AUTH_TOKEN and secrets.compare_digest(provided, AUTH_TOKEN):
                    matches = True
                elif token_file_content and secrets.compare_digest(provided, token_file_content):
                    AUTH_TOKEN = token_file_content
                    matches = True
                elif is_local and len(provided) >= 16:
                    AUTH_TOKEN = provided
                    sync_token_files(AUTH_TOKEN)
                    matches = True
                    print(f" 🔑 TOKEN SINCRONIZADO com cliente local {peer}", flush=True)

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

                    print(f" 🔑 AUTH OK de {peer} — ponte {'ARMADA (entradas liberadas)' if state['armed'] else 'EM SEGURO (sem entradas)'}{' + TRAVA DE EXECUÇÃO ligada (nenhuma entrada sai)' if ordens_bloqueadas() else ''}", flush=True)

                    await send_today_session_backfill(websocket, SYMBOL)
                    for extra_s in STREAM_SYMBOLS:
                        if extra_s != SYMBOL:
                            await send_today_session_backfill(websocket, extra_s)

                else:

                    print(f" ⛔ AUTH RECUSADO de {peer} — token inválido.", flush=True)

                    await websocket.close(code=4001, reason="token invalido")

                continue



            if action in ("ARM", "DISARM"):

                if REQUIRE_AUTH and not state["authenticated"]:

                    continue

                state["armed"] = action == "ARM"

                await send_json(websocket, {"type": "ARM_RESULT", "data": {"armed": state["armed"]}})

                print(f" {'🟢 PONTE ARMADA: ordens de entrada liberadas' if state['armed'] else '🔒 PONTE EM SEGURO: nenhuma entrada nova'}{' — mas TRAVA ligada: nenhuma entrada sai de fato' if ordens_bloqueadas() else ''} — {peer}", flush=True)

                continue



            if action == "SET_REPLAY_MODE":

                # Mesmo contrato de segurança do ARM: só quem provou o token mexe na execução.

                # Ligar é sempre aceito. Desligar com ORDERS_BLOCKED=1 no ambiente é RECUSADO em

                # voz alta -- a trava decidida no PC do MT5 não pode ser derrubada por quem está do

                # outro lado do socket (a tela é um cliente, não é a autoridade da máquina).

                if REQUIRE_AUTH and not state["authenticated"]:

                    print(f" ⛔ SET_REPLAY_MODE de {peer} sem autenticação — ignorado", flush=True)

                    continue

                wants = bool(data.get("on", True))

                recusa_ambiente = (not wants) and ORDERS_BLOCKED

                REPLAY_MODE = wants

                if REPLAY_MODE:

                    nota = ("MODO REPLAY/VALIDAÇÃO ligado: ticks, histórico, sinais e diário seguem "
                            "servidos, mas nenhuma ordem de entrada sai, armada ou não")

                elif recusa_ambiente:

                    nota = ("o modo replay da tela foi desligado, mas a TRAVA DE AMBIENTE "
                            "(ORDERS_BLOCKED=1) continua ligada neste processo -- para operar de "
                            "verdade, reinicie a ponte sem a variável")

                else:

                    nota = "entradas liberadas de novo para os clientes ARMADOS (pregão ao vivo)"

                payload = {

                    "on": REPLAY_MODE,

                    "blocked": ordens_bloqueadas(),

                    "envLocked": ORDERS_BLOCKED,

                    "recusaAmbiente": recusa_ambiente,

                    "note": nota,

                }

                # Toda tela conectada precisa saber da mesma verdade: se só a que clicou soubesse,

                # o outro notebook do operador mostraria 'Robô LIGADO' enquanto o processo segura tudo.

                await broadcast_to_web({"type": "REPLAY_MODE_RESULT", "data": payload})

                print(f" {'🎥 MODO REPLAY/VALIDAÇÃO LIGADO' if REPLAY_MODE else '▶️ MODO REPLAY/VALIDAÇÃO desligado'} — {nota} — {peer}", flush=True)

                continue



            if action == "GET_MT5_EQUITY":

                limit = int(data.get("limit") or 1000)

                days = int(data.get("days") or 30)

                await send_mt5_equity_data(websocket, limit=limit, days=days)

                continue



            if action == "SET_BOX_POINTS":
                new_box_pts = float(data.get("boxPoints") or 0)
                target_sym = str(data.get("symbol") or SYMBOL)
                if new_box_pts > 0:
                    BOX_POINTS = new_box_pts
                    if RENKO_ENGINE:
                        RENKO_ENGINE.box_points = BOX_POINTS
                    if target_sym in ENGINES:
                        ENGINES[target_sym].box_points = BOX_POINTS
                    print(f" 📏 Escala Renko alterada para {BOX_POINTS} pts ({target_sym})", flush=True)
                continue

            if action == "SYNC_EA_CONFIG":
                # A tela é a dona das regras: o operador mexe no limiar/filtros ali e a ponte
                # passa a julgar com aqueles números, sem reiniciar nada. Julga, não manda ordem.
                if REQUIRE_AUTH and not state["authenticated"]:
                    continue
                apply_ea_config(data.get("config") or data)
                await send_json(websocket, {"type": "EA_CONFIG_RESULT", "data": dict(EVAL_CONFIG)})
                continue

            if action == "GET_BACKFILL":
                req_sym = str(data.get("symbol") or SYMBOL)
                await send_today_session_backfill(websocket, req_sym)
                continue

            if action in ("SELECT_ASSET", "SELECT_SYMBOL"):
                new_asset_id = str(data.get("assetId") or "").upper()
                new_sym = str(data.get("symbol") or "")
                new_box_pts = float(data.get("boxPoints") or 0)

                if new_asset_id in SUPPORTED_ASSETS:
                    spec = SUPPORTED_ASSETS[new_asset_id]
                    SYMBOL = spec["symbol"]
                    ASSET_LABEL = spec["label"]
                    ASSET_DECIMALS = spec["decimals"]
                    ASSET_TICK_SIZE = spec["tick_size"]
                    ASSET_POINT_VALUE = spec["point_value"]
                    BOX_POINTS = new_box_pts if new_box_pts > 0 else spec["box_points"]
                elif new_sym:
                    SYMBOL = new_sym
                    spec = get_asset_spec(SYMBOL)
                    ASSET_LABEL = spec["label"]
                    ASSET_DECIMALS = spec["decimals"]
                    ASSET_TICK_SIZE = spec["tick_size"]
                    ASSET_POINT_VALUE = spec["point_value"]
                    if new_box_pts > 0:
                        BOX_POINTS = new_box_pts
                    else:
                        BOX_POINTS = spec["box_points"]

                eng = get_or_create_engine(SYMBOL)
                eng.box_points = BOX_POINTS
                eng.tick_size = ASSET_TICK_SIZE
                RENKO_ENGINE = eng

                with MT5_LOCK:
                    mt5.symbol_select(SYMBOL, True)
                    ref_new = mt5.symbol_info_tick(SYMBOL)

                if ref_new and (ref_new.last > 0 or ref_new.bid > 0):
                    p0 = float(ref_new.last if ref_new.last > 0 else ref_new.bid)
                    definir_cursor_ticks(SYMBOL, int(ref_new.time_msc))
                    RENKO_ENGINE.init_engine(p0, LAST_TICK_TIMES[SYMBOL] + MT5_BRT_OFFSET_MSC)
                    print(f" 🎯 Renko reancorado para {SYMBOL} em {p0} pts (Box {BOX_POINTS} pts, Tick {ASSET_TICK_SIZE})", flush=True)
                else:
                    rates = mt5.copy_rates_from_pos(SYMBOL, mt5.TIMEFRAME_M1, 0, 1)
                    if rates is not None and len(rates) > 0:
                        p0 = float(rates[-1]["close"])
                        t0 = (int(rates[-1]["time"]) + MT5_BRT_OFFSET_SEC) * 1000
                        RENKO_ENGINE.init_engine(p0, t0)
                        print(f" 🎯 Renko reancorado via M1 para {SYMBOL} em {p0} pts (Box {BOX_POINTS} pts, Tick {ASSET_TICK_SIZE})", flush=True)

                ORDER_MANAGER = get_or_create_order_manager(SYMBOL)

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



            if action == "LIST_LOCAL_PREGOES":

                req_symbol = str(data.get("symbol") or SYMBOL)

                import backtest_ticks_reais

                pregoes = await asyncio.to_thread(backtest_ticks_reais.list_local_pregoes, req_symbol)

                await send_json(websocket, {

                    "type": "LOCAL_PREGOES_LIST",

                    "data": pregoes

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

                    data.get("days") or 1,

                    # Resolução do bucket: `None` = a escada escolhe pelo teto de payload; um valor
                    # da tela pede caminho mais fino (mais eventos, mais fiel) ou mais grosso (rápido).
                    bucket_ms=data.get("resolucaoMs"),

                    desde=data.get("desde"),

                    ate=data.get("ate"),

                )

                continue



            if action == "SET_VARAL_CONFIG":
                sym = str(data.get("symbol") or SYMBOL)
                asset_k = "WIN" if "WIN" in sym else ("WDO" if "WDO" in sym else ("BIT" if "BIT" in sym else "WIN"))
                patch = data.get("config", {})
                if asset_k in VARAL_CONFIG and isinstance(patch, dict):
                    VARAL_CONFIG[asset_k].update(patch)
                    vmgr = get_or_create_varal_manager(sym)
                    vmgr.update_config(patch)
                    print(f"🧺 [VARAL] Configurações atualizadas para {asset_k} ({sym}): {VARAL_CONFIG[asset_k]}", flush=True)
                    await broadcast_to_web({
                        "type": "VARAL_CONFIG_UPDATE",
                        "symbol": sym,
                        "data": VARAL_CONFIG
                    })
                continue

            if action == "CLEAR_VARAL":
                sym = str(data.get("symbol") or SYMBOL)
                vmgr = get_or_create_varal_manager(sym)
                vmgr.cancel_pending_orders()
                vmgr.close_all_positions()
                vmgr.placed_orders_count = 0
                print(f"🧺 [VARAL] Ordens pendentes e posições do Varal limpas/zeradas para {sym}", flush=True)
                await send_account_info(websocket)
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

                target_sym = data.get("symbol") or SYMBOL
                mgr = get_or_create_order_manager(target_sym)

                if action == "ORDER_SEND":
                    order_magic = data.get("magic") or None
                    req_timestamp = data.get("timestamp") or data.get("tickTime") or None
                    if req_timestamp:
                        try:
                            req_timestamp = int(req_timestamp)
                            LAST_TAPE_TIME_MSC[target_sym] = req_timestamp
                        except (ValueError, TypeError):
                            req_timestamp = None
                    print(f" 📥 [WEBSOCKET] RECEBIDA SOLICITAÇÃO ORDER_SEND: {target_sym} {data.get('type')} {data.get('contracts', 1)} ctros | Magic={order_magic} SL={data.get('sl')} TP={data.get('tp')}", flush=True)

                    if data.get("isLimit"):

                        mgr.place_websocket_limit_order(

                            data.get("type", "BUY"),

                            float(data.get("limitPrice") or 0),

                            data.get("comment", "WEB_LIMIT"),

                            data.get("contracts", 1),

                            data.get("sl", 0) or 0,

                            data.get("tp", 0) or 0,

                            magic=order_magic,

                            tick_time_msc=req_timestamp

                        )

                    else:

                        try:

                            mgr.execute_market_order(

                                data.get("type", "BUY"),

                                comment=data.get("comment", "WEB_ORDER"),

                                volume=data.get("contracts", 1),

                                sl_points=data.get("sl", 0) or 0,

                                tp_points=data.get("tp", 0) or 0,

                                magic=order_magic,

                                acao="APP_ORDER_SEND",

                                tick_time_msc=req_timestamp

                            )

                        except Exception as exc:

                            # Clique manual na tela: a falha tem de aparecer no diário e no console da
                            # ponte, não derrubar o handler da conexão (o operador ficaria sem resposta).

                            mgr._audit_ordem("APP_ORDER_SEND", data.get("type", "BUY"),
                                                       data.get("contracts", 1), None, None, None, None, None,
                                                       False, f"EXCECAO_ANTES_DO_SEND | {type(exc).__name__}: {exc}")

                            print(f"❌ [ORDEM DA TELA ABORTADA ANTES DO ENVIO [{target_sym}]] {type(exc).__name__}: {exc}", flush=True)

                elif action == "ORDER_PARTIAL_CLOSE":

                    mgr.close_partial_position(

                        data.get("ticket"), data.get("partialVolume"), data.get("newSL"),

                        magic=data.get("robotMagic") or None

                    )

                elif action == "ORDER_MODIFY_SL":

                    mgr.modify_stop_loss(

                        data.get("ticket"), data.get("newSL"),

                        magic=data.get("robotMagic") or None

                    )

                elif action == "CLOSE_POSITIONS":

                    mgr.close_all_positions(

                        data.get("type"),

                        magic=data.get("robotMagic") if data.get("robotMagic") else None

                    )

                elif action == "SET_ROBOT_MODE":

                    asset_k = str(data.get("assetKey", "")).upper()
                    new_mode = str(data.get("mode", "COPILOT")).upper()
                    if asset_k in ROBOT_MODES:
                        ROBOT_MODES[asset_k] = new_mode
                        print(f" 🤖 MODO DO ROBÔ [{asset_k}] ALTERADO PARA: {new_mode}", flush=True)
                        await broadcast_to_web({"type": "ROBOT_MODES_UPDATE", "data": ROBOT_MODES})

    except websockets.exceptions.ConnectionClosed:

        pass

    finally:

        CONNECTED_CLIENTS.discard(websocket)

        CLIENT_STATES.pop(websocket, None)





async def broadcast_to_web(msg_dict):

    if not CONNECTED_CLIENTS:

        return

    msg_str = json.dumps(msg_dict)

    clients = []

    for client in list(CONNECTED_CLIENTS):

        state = CLIENT_STATES.get(client)

        if REQUIRE_AUTH and (state is None or not state.get("authenticated", False)):

            continue

        clients.append(client)

    if not clients:

        return

    async def _safe_send(c):
        try:
            await asyncio.wait_for(c.send(msg_str), timeout=1.5)
            return None
        except Exception:
            return c

    results = await asyncio.gather(*[_safe_send(c) for c in clients], return_exceptions=True)

    for r in results:

        if r and not isinstance(r, Exception):

            CONNECTED_CLIENTS.discard(r)

            CLIENT_STATES.pop(r, None)





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





async def _enviar_histico_replay(websocket, req_id, payload):
    """Despacha a série comprimida de ticks reais nos chunks do protocolo HISTORY_*.

    Os lotes vêm do `replay_dados` já com o tamanho do chunk, mas aqui eles são achatados e
    recortados de novo em `HISTORY_CHUNK_TICKS`: se as duas constantes divergirem no futuro, o
    que quebra é o protocolo (chunks do tamanho errado), não a fidelidade dos dados.
    """
    planos = [t for lote in payload["lotes"] for t in lote]
    total = len(planos)
    chunks = 0
    fid = payload.get("fidelidade") or {}
    for start in range(0, total, HISTORY_CHUNK_TICKS):
        await send_json(websocket, {
            "type": "HISTORY_CHUNK",
            "data": {
                "reqId": req_id,
                "index": chunks,
                "volumeSource": VOLUME_SOURCE_TICKS_REAIS,
                "resolucaoMs": payload["resolucaoMs"],
                "ticks": planos[start:start + HISTORY_CHUNK_TICKS],
            },
        })
        chunks += 1

    await send_json(websocket, {
        "type": "HISTORY_DONE",
        "data": {
            "reqId": req_id,
            "count": total,
            "chunks": chunks,
            "days": len(payload["dias"]),
            "diasServidos": payload["dias"],
            "arquivosServidos": payload["arquivos"],
            "symbol": payload["symbol"],
            "volumeSource": VOLUME_SOURCE_TICKS_REAIS,
            "resolucaoMs": payload["resolucaoMs"],
            # existe apenas quando o orçamento obrigou a trocar a resolução pedida
            "resolucaoPedidaMs": payload.get("resolucaoPedidaMs"),
            "ticksReaisLidos": payload["ticks_reais"],
            "buckets": payload["buckets"],
            "contratosCompra": payload["contratos_buy"],
            "contratosVenda": payload["contratos_sell"],
            # a faixa de fidelidade medida via junto com a resolução: "TICKS_REAIS" diz de onde
            # veio o dado, mas é o alinhamento que diz se o replay pode julgar limiar de estratégia
            # ou só o caminho. Omitir isso seria a tela vender validação onde só há ensaio.
            "validaEstrategia": payload.get("validaEstrategia"),
            "alinhamentoMedido": fid.get("alinhamento"),
            "erroDeltaMedido": fid.get("erro_delta"),
            "sinaisRecuperados": fid.get("sinais"),
            "nota": (f"Fita real: {payload['ticks_reais']:,} ticks de negócio comprimidos em "
                     f"{payload['buckets']:,} buckets de {payload['resolucaoMs']} ms "
                     f"({total:,} eventos). Σcompra/Σvenda e o caminho de preço são os da fita; "
                     f"viradas dentro de um bucket não existem nesta série."
                     + ("" if payload.get("validaEstrategia") is True else
                        f" FORA DA FAIXA VALIDADA: a {payload['resolucaoMs']} ms o Δ por box mede "
                        f"{fid.get('erro_delta', float('nan')):.0%} de erro contra a fita cheia -- "
                        f"serve para caminho, não para calibrar limiar."
                        if payload.get("validaEstrategia") is False else
                        f" FIDELIDADE NÃO MEDIDA para {payload['resolucaoMs']} ms: a série é a fita "
                        f"real, mas o Δ desta resolução não foi medido contra a fita cheia, então "
                        f"não se pode afirmar que calibra limiar."))
                     + (f" Resolução PEDIDA {payload['resolucaoPedidaMs']} ms não coube no orçamento "
                        f"de bytes da resposta; servido {payload['resolucaoMs']} ms."
                        if payload.get("resolucaoPedidaMs") else ""),
        },
    })

    print(f"📜 HISTÓRICO (TICKS REAIS) a {get_peer_ip(websocket)}: {total:,} eventos de "
          f"'{payload['symbol']}' ({', '.join(payload['dias'])}) — fita de "
          f"{payload['ticks_reais']:,} ticks em buckets de {payload['resolucaoMs']} ms, "
          f"{chunks} chunk(s), arquivos: {', '.join(payload['arquivos'])}", flush=True)


async def handle_request_history(websocket, req_id, symbol, days, bucket_ms=None, desde=None, ate=None):

    """Histórico do replay: fita REAL de disco quando existe, M1 rotulado quando não existe.

    Antes este atendimento fabricava 4 ticks por barra M1 com `vol = tick_volume // 4` — e
    `tick_volume` é CONTAGEM de ticks, não contratos. Medido contra a fita de 04/Nov/2026
    (WINZ26, 08:55-17:30): a tela via 1.012x menos eventos com 'volume' 10,5x menor que os
    21.492.107 contratos negociados. Delta, CVD e convergência deixavam de significar qualquer
    coisa, então o replay servia para ensaiar a tela e nada para validar estratégia.

    Agora a fonte primária é `replay_dados.servir_histico`, que lê os MESMOS recortes que
    `reproduzir_pregao.py` usa e comprime por bucket preservando caminho de preço e fluxo por
    lado. O M1 continua como fallback legítimo (dia que não foi extraído), mas sai rotulado
    `M1_RATE` com a resolução e a nota da fonte, para a tela poder dizer de onde veio.

    Custo: ler 2,1M de linhas de um .gz e comprimir leva segundos de CPU/disco, por isso vai para
    `asyncio.to_thread` — nunca encosta no laço de ticks nem no `MT5_LOCK`.
    """

    try:

        days = max(1, min(HISTORY_MAX_DAYS, int(days or 1)))

    except (TypeError, ValueError):

        days = 1



    # ---- caminho 1: a fita real do pregão, comprimida ------------------------------------
    motivo_fallback = ""
    if REPLAY_DADOS_ENABLED:

        try:

            payload = await asyncio.to_thread(

                replay.servir_histico, symbol, days, bucket_ms, desde, ate

            )

        except Exception as exc:

            payload = None

            motivo_fallback = f"replay_dados: {exc}"

            print(f"[AVISO] replay de ticks reais falhou para {symbol}: {exc}", flush=True)

        else:

            if payload is None:

                motivo_fallback = f"nenhum pregão de {symbol} em disco"

        if payload:

            await _enviar_histico_replay(websocket, req_id, payload)

            return

    # ---- caminho 2: barras M1 (fallback, rotulado como o que é) --------------------------
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

                "volumeSource": VOLUME_SOURCE_M1,

                "resolucaoMs": 60_000,

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

            "volumeSource": VOLUME_SOURCE_M1,

            "resolucaoMs": 60_000,

            "nota": (f"Fallback M1: 4 ticks fabricados por barra de 1 minuto "
                     f"({total:,} eventos). O 'volume' aqui é contagem de ticks dividida em 4, "
                     f"NÃO contratos negociados — Delta e CVD desta série não medem estratégia. "
                     f"{motivo_fallback}")

        }

    })

    print(f"📜 HISTÓRICO (M1, fallback) a {get_peer_ip(websocket)}: {total} ticks sintéticos de "
          f"'{symbol}' ({days} dia(s)) em {chunks} chunk(s). Motivo: {motivo_fallback or 'M1 pedido'}", flush=True)





STREAM_SYMBOLS = ["WINZ26", "WDOZ26", "BITX26"]
LAST_TICK_TIMES = {s: 0 for s in STREAM_SYMBOLS}
# Quantos ticks DESSE MESMO milissegundo já entraram. O MT5 emite vários ticks na mesma ms
# (bid/ask/last mudando dentro do mesmo milissegundo) e o dedup antigo por `<=` no `time_msc`
# deixava passar só o primeiro — 11,5% da fita do WIN perdidos em 04/Nov.
LAST_TICK_OCC = {s: None for s in STREAM_SYMBOLS}
# A fita do WIN teve pico de 1.326 ticks em um único segundo (04/Nov/2026), então o cap precisa
# ficar acima disso com folga: lote cheio = cauda do segundo que nunca seria devolvida.
TICK_BATCH_MAX = 5000


def definir_cursor_ticks(s, raw_msc):
    """Marca até onde a fita daquele ativo já foi consumida pelo motor."""
    LAST_TICK_TIMES[s] = int(raw_msc)
    # `None` = conhecemos o MILISSEGUNDO do cursor mas não qual ocorrência dele já entrou (é o
    # caso do tick lido em `symbol_info_tick` na boot/reancora), então aquela ms inteira é velha.
    LAST_TICK_OCC[s] = None


def cursor_de_ingestao(ticks, ultimo_msc, ultimo_oc):
    """Índice do primeiro tick daquele lote que ainda NÃO entrou no motor.

    A consulta é ancorada no segundo do último tick processado e por isso relê a cabeça daquele
    segundo a cada poll. Cortar pelo `searchsorted` (em C, sobre o array do MT5) é o que mantém
    o loop barato nos picos, e o `ultimo_oc` é o que impede de pular irmãos do mesmo ms que
    chegaram depois do nosso cursor — sem isso a correção viraria perda de novo.
    """
    n = len(ticks)
    if n == 0 or ultimo_msc <= 0:
        return 0
    if isinstance(ticks, (list, tuple)):
        # caminho dos testes offline, sem ndarray do MT5
        tempos = [int(t["time_msc"]) for t in ticks]
        inicio = bisect_left(tempos, ultimo_msc)
        fim = bisect_right(tempos, ultimo_msc)
    else:
        tempos = ticks["time_msc"]
        inicio = int(np.searchsorted(tempos, ultimo_msc, side="left"))
        fim = int(np.searchsorted(tempos, ultimo_msc, side="right"))
    if fim == inicio:
        return inicio
    if ultimo_oc is None:
        return fim
    return inicio + min(int(ultimo_oc) + 1, fim - inicio)


def anchor_da_consulta(s, server_time_sec):
    """Segundo onde a consulta da fita daquele ativo deve começar.

    NÃO é `server_time_sec - 3`: com um cap por consulta, a janela deslizante abandonava a
    cauda dos segundos concorridos (a fita do WIN passa de 1.000 ticks num segundo no pico).
    Ancorar no segundo do último tick PROCESSADO relê aquele segundo — o `cursor_de_ingestao`
    corta o que já entrou — e por isso nada fica para trás, nem quando o loop atrasa.
    """
    ultimo_msc = LAST_TICK_TIMES.get(s, 0)
    return ultimo_msc // 1000 if ultimo_msc > 0 else int(server_time_sec)


def cursor_seguinte(s, raw_msc):
    """Avança o cursor da fita para este tick e devolve a ocorrência dele no milissegundo.

    Como o lote chega ordenado, todos os irmãos do mesmo ms são consecutivos: basta comparar o
    ms com o do último tick consumido. É essa ocorrência que o `cursor_de_ingestao` usa para
    retomar exatamente de onde paramos quando a consulta relê o mesmo segundo.
    """
    if raw_msc == LAST_TICK_TIMES.get(s, 0):
        oc = int(LAST_TICK_OCC.get(s) or 0) + 1
    else:
        oc = 0
    LAST_TICK_TIMES[s] = int(raw_msc)
    LAST_TICK_OCC[s] = oc
    return oc


async def mt5_stream_loop():
    global LAST_TICK_TIMES, LAST_TICK_OCC, RENKO_ENGINE, ENGINES, ORDER_MANAGERS
    for s in STREAM_SYMBOLS:
        with MT5_LOCK:
            mt5.symbol_select(s, True)
            ref_i = mt5.symbol_info_tick(s)
            if ref_i:
                definir_cursor_ticks(s, ref_i.time_msc)
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

                ultimo_msc = LAST_TICK_TIMES.get(s, 0)
                # A âncora é o SEGUNDO do último tick que entrou no motor, e não 3s atrás do
                # último tick que o terminal viu: com cap por consulta, a cauda dos segundos
                # concorridos saía da janela sem nunca ter sido devolvida (14,1% da fita).
                anchor_sec = anchor_da_consulta(s, int(ref.time))
                with MT5_LOCK:
                    ticks = mt5.copy_ticks_from(s, anchor_sec, TICK_BATCH_MAX, mt5.COPY_TICKS_ALL)

                if ticks is not None and len(ticks) > 0:
                    if len(ticks) >= TICK_BATCH_MAX:
                        print(f"⚠️ [STREAM {s}] lote cheio ({TICK_BATCH_MAX}): pode haver tick além do cap",
                              flush=True)
                    eng = get_or_create_engine(s)
                    mgr = get_or_create_order_manager(s)
                    corte = cursor_de_ingestao(ticks, ultimo_msc, LAST_TICK_OCC.get(s))
                    batch_ticks = []
                    for tick in ticks[corte:]:
                        raw_msc = int(tick['time_msc'])
                        cursor_seguinte(s, raw_msc)

                        price = _tick_price(tick)
                        if price <= 0:
                            continue
                        volume = int(_field(tick, "volume", 0) or _field(tick, "volume_real", 0) or 1)
                        flags = int(tick['flags'])
                        aggressor = "BUY" if (flags & mt5.TICK_FLAG_BUY) else ("SELL" if (flags & mt5.TICK_FLAG_SELL) else "CROSS")
                        ts_msc = raw_msc + MT5_BRT_OFFSET_MSC
                        LAST_TAPE_TIME_MSC[s] = ts_msc

                        batch_ticks.append({
                            "id": f"mt5-{s}-{ts_msc}",
                            "symbol": s,
                            "timestamp": ts_msc,
                            "timeStr": datetime.fromtimestamp(ts_msc / 1000).strftime('%H:%M:%S.%f')[:-3],
                            "price": price,
                            "volume": volume,
                            "aggressor": aggressor
                        })

                        # O motor Renko de CADA ativo processa o tick concorrentemente
                        new_box, signal, reason = eng.process_tick(price, volume, aggressor, ts_msc)
                        if new_box:
                            print(f"[{datetime.fromtimestamp(ts_msc/1000).strftime('%H:%M:%S')}] Box {s} #{new_box['index']}: {new_box['direction']} | {new_box['open']} -> {new_box['close']}", flush=True)
                            # Uma linha por box fechado, sinal OU corte, com o motivo do veredito
                            if AUDITORIA_ENABLED:
                                try:
                                    audit_registrar_box(new_box, new_box.get("audit"), "VIVO", s)
                                except Exception as _audit_exc:
                                    print(f"[AVISO] falha no diário de boxes: {_audit_exc}", flush=True)
                            await broadcast_to_web({"type": "BOX_CLOSED", "symbol": s, "data": new_box})
                            mgr.check_and_clean_expired_pending(new_box["index"])
                            mgr.watch_closed_pyramids()
                            mgr.update_trailing_stop_box(new_box)

                            # ROBÔ 2: VARAL DE ORDENS (SOMBRA REAL NO MT5)
                            # Acionado a cada novo box ('C' para alta / 'V' para baixa) independentemente do Robô Mestre
                            try:
                                if not ordens_bloqueadas():
                                    varal_mgr = get_or_create_varal_manager(s)
                                    box_dir = "C" if new_box["direction"] == "UP" else "V"
                                    varal_mgr.on_box_signal(box_dir, new_box["close"], tick_time_msc=ts_msc)
                            except Exception as _varal_exc:
                                print(f"[AVISO] Falha ao acionar varal para {s}: {_varal_exc}", flush=True)

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
                                        "timestamp": ts_msc,
                                        "flowScore": new_box.get("flow_score", 5),
                                        "flowScoreBreakdown": new_box.get("flow_score_breakdown", {})
                                    }
                                })
                                # Se a ponte estiver armada em qualquer cliente, executa com o magic number do ativo.
                                # A trava de ambiente passa na frente do armado: um cliente ARMADO (a tela reenvia
                                # `armed` no AUTH sozinha) jamais pode abrir posição enquanto o operador decidiu
                                # rodar em seguro.
                                asset_k = "WIN" if "WIN" in s else ("WDO" if "WDO" in s else ("BIT" if "BIT" in s else "WIN"))
                                current_mode = ROBOT_MODES.get(asset_k, "COPILOT")

                                if ordens_bloqueadas():
                                    print(f" 🛑 ORDEM BLOQUEADA POR TRAVA [{'ORDERS_BLOCKED' if ORDERS_BLOCKED else 'MODO REPLAY'}] [{s}]: sinal "
                                          f"{signal} ({reason}) calculado e transmitido, nenhuma ordem enviada",
                                          flush=True)
                                elif current_mode == "AUTO":
                                    if any(client_state(c).get("armed", False) for c in CONNECTED_CLIENTS):
                                        mgr.execute_pyramid_confluence(signal, new_box)
                                else:
                                    print(f" 🎯 SINAL [{s}] DISPONÍVEL NO COPILOTO [{current_mode}]: {signal} ({reason}) — aguardando operador", flush=True)

                    if batch_ticks:
                        if len(batch_ticks) == 1:
                            await broadcast_to_web({
                                "type": "TICK",
                                "symbol": s,
                                "data": batch_ticks[0]
                            })
                        else:
                            await broadcast_to_web({
                                "type": "TICKS_BATCH",
                                "symbol": s,
                                "data": batch_ticks
                            })

            await asyncio.sleep(0.01)
        except Exception as exc:
            print(f"[AVISO STREAM] {exc}", flush=True)
            await asyncio.sleep(0.05)

async def mt5_equity_broadcaster_loop():

    while True:

        await asyncio.sleep(3.0)

        if not CONNECTED_CLIENTS:

            continue

        try:

            with MT5_LOCK:

                acc = mt5.account_info()

            if not acc:

                continue

            positions = await asyncio.to_thread(fetch_mt5_positions)

            day_stats_pack = await asyncio.to_thread(fetch_mt5_day_stats, SYMBOL)

            await broadcast_to_web({

                "type": "MT5_EQUITY_UPDATE",

                "data": {

                    "balance": acc.balance,

                    "equity": acc.equity,

                    "floatingProfit": acc.profit,

                    "margin": acc.margin,

                    "marginFree": acc.margin_free,

                    "positions": positions,

                    "dayStats": day_stats_pack["current"],

                    "dayStatsGlobal": day_stats_pack["global"],

                    "dayStatsBySymbol": day_stats_pack["bySymbol"]

                }

            })

        except Exception:

            pass



def capturar_extrato_mt5(rotulo="inicial"):
    """Grava no disco o extrato REAL de negócios da conta e o snapshot de saldo.

    É a única prova de performance que não depende de print de console: os deals da
    corretora dizem o que de fato aconteceu (PnL, comissão, preço de fill), e é contra eles
    que a reprodução offline é comparada. Regravável: o arquivo do dia é substituído, não
    anexado, porque é um snapshot da história.
    """
    if not AUDITORIA_ENABLED:
        return 0
    try:
        with MT5_LOCK:
            conta = mt5.account_info()
            hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            inicio = int(hoje.timestamp())
            deals = mt5.history_deals_get(inicio, inicio + 86400)
        if conta:
            audit_salvar_conta(conta)
        lista = list(deals or [])
        caminho = audit_salvar_deals(lista)
        print(f" 🧾 EXTRATO MT5 GRAVADO ({rotulo}): {len(lista)} negócio(s) → {os.path.basename(caminho)}", flush=True)
        return len(lista)
    except Exception as exc:
        print(f"[AVISO] falha ao gravar extrato MT5: {exc}", flush=True)
        return 0


async def extrato_mt5_loop():
    """Renova o extrato real a cada 5 minutos e no fechamento, sem depender do app aberto."""
    while True:
        await asyncio.sleep(300)
        capturar_extrato_mt5("periodico")


async def main():

    global ORDER_MANAGER, RENKO_ENGINE

    # O caminho é obrigatório nesta máquina: existem DUAS instalações do MT5
    # (`C:\Program Files\MetaTrader 5` e `C:\Program Files\MetaTrader 5 Terminal`).
    # Sem `path`, a lib abre a instalação padrão — que não é a da XP e não está
    # logada — e devolve (-6, 'Terminal: Authorization failed').
    #
    # O terminal também cai de sessão sozinho (queda de rede / servidor demo). Antes
    # a ponte morria no primeiro (-6) e o operador tinha que religar na mão; agora ela
    # espera a autorização voltar e sobe o WebSocket na hora em que voltar.
    tentativa = 0

    while not mt5.initialize(path=MT5_PATH):

        tentativa += 1

        print(
            f"[AVISO] MT5 sem autorização em {MT5_PATH} — {mt5.last_error()} — "
            f"tentativa {tentativa}, nova checagem em 5s",
            flush=True,
        )

        await asyncio.sleep(5)



    conta = mt5.account_info()

    print(
        f" MT5 conectado: conta {getattr(conta, 'login', '?')} ({getattr(conta, 'server', '?')}) — "
        f"ativo {SYMBOL}",
        flush=True,
    )



    mt5.symbol_select(SYMBOL, True)

    RENKO_ENGINE = RenkoFlowEngine(box_points=BOX_POINTS)

    ORDER_MANAGER = MT5OrderManager(symbol=SYMBOL, contracts=MAIN_CONTRACTS, magic_number=MAGIC_NUMBER)



    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT, max_size=50 * 1024 * 1024, ping_interval=20, ping_timeout=20)

    print(f" Servidor WebSocket ativo em toda a rede local na porta {WS_PORT} — pronto para conectar!", flush=True)

    # A trava precisa aparecer no boot, antes de qualquer conversa com a tela: se o operador for
    # rodar replay/validação, é aqui que ele confere que nenhuma ordem de entrada sai nesta sessão.
    if ORDERS_BLOCKED:
        print(" 🛑 TRAVA DE EXECUÇÃO ATIVA (ORDERS_BLOCKED): a ponte serve ticks, histórico, sinais e "
              "diário, mas NÃO envia nenhuma ordem de entrada -- modo replay/validação. Essa trava do "
              "ambiente só cai reiniciando o processo sem a variável.", flush=True)
    else:
        print(" ▶️  TRAVA DE EXECUÇÃO desligada: entradas liberadas para clientes ARMADOS (pregão ao "
              "vivo). Para ensaiar sem tocar na conta, ligue o MODO REPLAY na tela (ou rode com "
              "ORDERS_BLOCKED=1).", flush=True)

    # Extrato da corretora no disco assim que a ponte enxerga a conta, e de 5 em 5 minutos:
    # se o processo cair, o pregão já está auditado até aquele ponto.
    capturar_extrato_mt5("ao_ligar")

    asyncio.create_task(extrato_mt5_loop())

    try:

        await asyncio.gather(server.wait_closed(), mt5_stream_loop(), mt5_equity_broadcaster_loop())

    except KeyboardInterrupt:

        pass

    finally:

        mt5.shutdown()





if __name__ == "__main__":

    asyncio.run(main())

