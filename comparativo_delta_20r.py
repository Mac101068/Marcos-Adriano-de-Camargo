"""
Comparativo de Calibração de Delta no Renko 20R (5 Pregões B3)
Compara os limiares de Delta: 100 vs 250 vs 350 vs 500 contratos.
"""
import sys
import os
import json
from datetime import datetime, timedelta
import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

import web_app
from fluxo_atemporal_modulo import RenkoFlowEngine, check_market_accumulation
from backtest_renko import preparar_ticks, VALOR_PONTO_WIN

def carregar_config():
    cfg_file = os.path.join(os.path.dirname(__file__), "renko_config.json")
    with open(cfg_file, "r", encoding="utf-8") as f:
        return json.load(f)

class BacktestSimulador:
    def __init__(self, min_delta: float, box_pts: int = 100, tp_pir: float = 100.0,
                 custo_pts: float = 5.0, daily_meta: float = 1000.0, daily_stop: float = 800.0):
        self.min_delta = min_delta
        self.box_pts = box_pts
        self.tp_pir = tp_pir
        self.custo_pts = custo_pts
        self.daily_meta = daily_meta
        self.daily_stop = daily_stop

        self.engine = RenkoFlowEngine(box_points=self.box_pts, min_delta=self.min_delta)
        self.mae = None
        self.pirs = []
        self.trades = []
        self.locked_day = False
        self.lock_reason = ""
        self.acc_blocked = 0

    def calcular_lucro_liquido(self) -> float:
        return sum(t["resultado_pts"] for t in self.trades) * VALOR_PONTO_WIN

    def _fechar(self, pos: dict, preco: float, hora: str, motivo: str):
        lado = 1 if pos["dir"] == "BUY" else -1
        pts = (preco - pos["preco"]) * lado - self.custo_pts
        self.trades.append({
            **pos,
            "saida": preco,
            "hora_saida": hora,
            "motivo": motivo,
            "pts": pts,
            "resultado_pts": pts * pos["qtd"]
        })

    def _zerar_tudo(self, preco: float, hora: str, motivo: str):
        if self.mae:
            self._fechar(self.mae, preco, hora, motivo)
            self.mae = None
        for p in self.pirs:
            self._fechar(p, preco, hora, motivo)
        self.pirs = []

    def on_tick(self, preco: float, vol: float, agg: int, hora: str):
        if self.locked_day:
            return

        hhmm = hora[:5]

        # 1. Alvos de Pirâmide
        restantes = []
        for p in self.pirs:
            if (p["dir"] == "BUY" and preco >= p["alvo"]) or (p["dir"] == "SELL" and preco <= p["alvo"]):
                self._fechar(p, p["alvo"], hora, "TP")
            else:
                restantes.append(p)
        self.pirs = restantes

        # 2. Travas de Risco Diárias
        lucro = self.calcular_lucro_liquido()
        if self.daily_meta > 0 and lucro >= self.daily_meta:
            self._zerar_tudo(preco, hora, "META_ATINGIDA")
            self.locked_day = True
            self.lock_reason = "META_ATINGIDA"
            return
        if self.daily_stop > 0 and lucro <= -self.daily_stop:
            self._zerar_tudo(preco, hora, "STOP_ATINGIDO")
            self.locked_day = True
            self.lock_reason = "STOP_ATINGIDO"
            return

        if hhmm >= "17:50":
            if self.mae or self.pirs:
                self._zerar_tudo(preco, hora, "FIM_PREGAO")
            self.locked_day = True
            return

        aggressor = "BUY" if agg > 0 else ("SELL" if agg < 0 else None)
        new_box, signal, reason = self.engine.process_tick(preco, vol, aggressor, hora)

        if not (signal and new_box):
            return

        if not ("09:05" <= hhmm < "17:40"):
            return

        # Filtro de Acumulação
        if len(self.engine.boxes) >= 6:
            is_acc, _, _, _, _ = check_market_accumulation(
                self.engine.boxes, new_box, window_size=6, max_alternations=3, min_range_mult=2.0, box_points=self.box_pts
            )
            if is_acc:
                self.acc_blocked += 1
                return

        # Inversão
        dir_atual = self.mae["dir"] if self.mae else (self.pirs[0]["dir"] if self.pirs else None)
        if dir_atual and dir_atual != signal:
            self._zerar_tudo(preco, hora, "INVERSAO")

        if self.mae is None:
            self.mae = {"tipo": "MAE", "dir": signal, "preco": preco, "qtd": 1.0, "hora_entrada": hora}
        elif len(self.pirs) < 15:
            alvo = preco + self.tp_pir if signal == "BUY" else preco - self.tp_pir
            self.pirs.append({"tipo": "PIR", "dir": signal, "preco": preco, "alvo": alvo, "qtd": 1.0, "hora_entrada": hora})

    def finalizar(self, preco: float, hora: str):
        if self.mae or self.pirs:
            self._zerar_tudo(preco, hora, "FIM")

    def resumo(self):
        if not self.trades:
            return {"ops": 0, "pts": 0.0, "reais": 0.0, "acerto": 0.0, "dd": 0.0, "meta_batida": False, "stop_batido": False}
        res_pts = np.array([t["resultado_pts"] for t in self.trades])
        res_reais = res_pts * VALOR_PONTO_WIN
        curva = np.cumsum(res_reais)
        dd = float(np.max(np.maximum.accumulate(np.concatenate([[0], curva]))[1:] - curva))
        return {
            "ops": len(self.trades),
            "pts": float(res_pts.sum()),
            "reais": float(res_reais.sum()),
            "acerto": float((res_reais > 0).mean() * 100),
            "dd": dd,
            "meta_batida": self.lock_reason == "META_ATINGIDA",
            "stop_batido": self.lock_reason == "STOP_ATINGIDO"
        }

def executar_comparativo():
    print("=" * 80)
    print("🔬 COMPARATIVO QUANTITATIVO: CALIBRAÇÃO DE DELTA (RENKO 20R - 100 PTS)")
    print("=" * 80)

    pregoes = []
    dia = datetime.now()
    tentativas = 0
    while len(pregoes) < 5 and tentativas < 15:
        if tentativas > 0:
            dia -= timedelta(days=1)
        tentativas += 1
        if dia.weekday() >= 5:
            continue
        d_str = dia.strftime("%Y-%m-%d")
        df, info = web_app.buscar_ticks_historicos("WINZ26", d_str, num_ticks=None)
        if df is None or len(df) == 0:
            continue
        if any(p["info"] == info for p in pregoes):
            continue
        ticks = preparar_ticks(df)
        pregoes.append({"info": info, "ticks": ticks})
        print(f"📥 Pregão carregado: {info} ({len(ticks['preco']):,} ticks)")

    deltas_teste = [100, 250, 350, 500]

    print("\n" + "=" * 80)
    print(f"{'Delta Mínimo':<14} | {'Trades':<8} | {'Acerto':<8} | {'Pontos Líq.':<12} | {'Resultado R$':<14} | {'Pior DD':<10} | {'Dias +':<6}")
    print("-" * 80)

    for d in deltas_teste:
        tot_ops = 0
        tot_pts = 0.0
        tot_reais = 0.0
        acertos_list = []
        pior_dd = 0.0
        dias_positivos = 0

        for p in pregoes:
            bt = BacktestSimulador(min_delta=d, box_pts=100, tp_pir=100.0, custo_pts=5.0, daily_meta=1000.0, daily_stop=800.0)
            ticks = p["ticks"]
            for i in range(len(ticks["preco"])):
                bt.on_tick(ticks["preco"][i], ticks["vol"][i], int(ticks["agg"][i]), ticks["hora"][i])
            bt.finalizar(ticks["preco"][-1], ticks["hora"][-1])
            res = bt.resumo()

            tot_ops += res["ops"]
            tot_pts += res["pts"]
            tot_reais += res["reais"]
            if res["ops"] > 0:
                acertos_list.append(res["acerto"])
            pior_dd = max(pior_dd, res["dd"])
            if res["reais"] > 0:
                dias_positivos += 1

        acerto_medio = sum(acertos_list) / len(acertos_list) if acertos_list else 0.0
        print(f"Δ ≥ {d:<9} | {tot_ops:<8} | {acerto_medio:>5.1f}%  | {tot_pts:>+10,.0f}  | R$ {tot_reais:>+10,.2f} | R$ {pior_dd:>7,.2f} | {dias_positivos}/5")

    print("=" * 80)

if __name__ == "__main__":
    executar_comparativo()
