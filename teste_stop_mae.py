import sys
import os
import json
from datetime import datetime, timedelta
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

import web_app
from fluxo_atemporal_modulo import RenkoFlowEngine, check_market_accumulation
from backtest_renko import preparar_ticks, VALOR_PONTO_WIN

class BacktestComStopMae:
    def __init__(self, min_delta=250.0, box_pts=100, tp_pir=100.0, sl_mae=100.0, custo_pts=5.0, daily_meta=1000.0, daily_stop=800.0):
        self.min_delta = min_delta
        self.box_pts = box_pts
        self.tp_pir = tp_pir
        self.sl_mae = sl_mae  # Stop Loss em pontos para a posição mãe (0 = sem stop)
        self.custo_pts = custo_pts
        self.daily_meta = daily_meta
        self.daily_stop = daily_stop

        self.engine = RenkoFlowEngine(box_points=self.box_pts, min_delta=self.min_delta)
        self.mae = None
        self.pirs = []
        self.trades = []
        self.locked_day = False
        self.lock_reason = ""

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
                self._fechar(p, p["alvo"], hora, "TP_PIR")
            else:
                restantes.append(p)
        self.pirs = restantes

        # 2. Stop Loss da Posição Mãe (se configurado)
        if self.mae and self.sl_mae > 0:
            if self.mae["dir"] == "BUY" and preco <= (self.mae["preco"] - self.sl_mae):
                self._fechar(self.mae, self.mae["preco"] - self.sl_mae, hora, "SL_MAE")
                self.mae = None
            elif self.mae["dir"] == "SELL" and preco >= (self.mae["preco"] + self.sl_mae):
                self._fechar(self.mae, self.mae["preco"] + self.sl_mae, hora, "SL_MAE")
                self.mae = None

        # 3. Travas de Risco Diárias
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
            return {"ops": 0, "pts": 0.0, "reais": 0.0, "acerto": 0.0, "dd": 0.0}
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
            "motivo": self.lock_reason or "FIM"
        }

if __name__ == "__main__":
    pregoes = []
    dia = datetime.now()
    while len(pregoes) < 5:
        dia -= timedelta(days=1)
        if dia.weekday() >= 5: continue
        df, info = web_app.buscar_ticks_historicos("WINZ26", dia.strftime("%Y-%m-%d"), num_ticks=None)
        if df is not None and len(df) > 0 and not any(p["info"] == info for p in pregoes):
            pregoes.append({"info": info, "ticks": preparar_ticks(df)})

    print("=" * 85)
    print(f"CALIBRAÇÃO COM DELTA >= 250: COMPARATIVO DE STOP LOSS NA POSIÇÃO MÃE")
    print("=" * 85)
    print(f"{'Configuração SL Mãe':<24} | {'Ops':<6} | {'Acerto':<8} | {'Pontos':<10} | {'Resultado R$':<14} | {'Pior DD':<10} | {'Dias +'}")
    print("-" * 85)

    cenarios = [
        ("Sem SL (Só Inversão 200p)", 0.0),
        ("SL Fixo 100p (1 Box)", 100.0),
        ("SL Fixo 150p (1.5 Box)", 150.0),
    ]

    for label, sl_val in cenarios:
        tot_ops = 0
        tot_pts = 0.0
        tot_reais = 0.0
        pior_dd = 0.0
        dias_pos = 0
        acertos = []

        for p in pregoes:
            bt = BacktestComStopMae(min_delta=250.0, box_pts=100, tp_pir=100.0, sl_mae=sl_val, custo_pts=5.0, daily_meta=1000.0, daily_stop=800.0)
            ticks = p["ticks"]
            for i in range(len(ticks["preco"])):
                bt.on_tick(ticks["preco"][i], ticks["vol"][i], int(ticks["agg"][i]), ticks["hora"][i])
            bt.finalizar(ticks["preco"][-1], ticks["hora"][-1])
            res = bt.resumo()
            tot_ops += res["ops"]
            tot_pts += res["pts"]
            tot_reais += res["reais"]
            pior_dd = max(pior_dd, res["dd"])
            if res["ops"] > 0:
                acertos.append(res["acerto"])
            if res["reais"] > 0:
                dias_pos += 1

        acerto_medio = sum(acertos) / len(acertos) if acertos else 0.0
        print(f"{label:<24} | {tot_ops:<6} | {acerto_medio:>6.1f}% | {tot_pts:>+8,.0f}  | R$ {tot_reais:>+10,.2f} | R$ {pior_dd:>7,.2f} | {dias_pos}/5")
    print("=" * 85)
