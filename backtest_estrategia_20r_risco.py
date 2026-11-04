"""
Backtest Quantitativo Institucional - Renko 20R & Gestão de Risco B3
Simula tick-a-tick os parâmetros reais configurados em renko_config.json:
- Renko 20R (100 pontos por box)
- Take Profit Pirâmide: +100 pts
- Ordem Mãe de Surfe com encerramento por reversão de fluxo
- Filtro de Acumulação / Consolidação (Janela 6 boxes, máx 3 alternâncias)
- Travas Diárias de Capital: Meta Diária (R$ 1.000), Stop Diário (R$ 800) e Trailing de Capital (Trigger R$ 800 / Giveback R$ 250)
"""
import sys
import os
import json
from datetime import datetime
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

class BacktestInstitucional20R:
    def __init__(self, cfg: dict, aplicar_travas_diarias: bool = True, custo_pts: float = 5.0):
        self.cfg = cfg
        self.aplicar_travas = aplicar_travas_diarias
        self.custo_pts = custo_pts

        self.box_pts = int(cfg.get("box_points", 100))
        self.tp_pir = float(cfg.get("pyramid_tp_points", self.box_pts))
        self.min_delta = float(cfg.get("min_delta_threshold", 100.0))
        self.min_reversal_delta = float(cfg.get("min_reversal_delta", 75.0))
        
        self.acc_filter_enabled = bool(cfg.get("accumulation_filter_enabled", True))
        self.acc_window = int(cfg.get("accumulation_window_boxes", 6))
        self.acc_max_alt = int(cfg.get("accumulation_max_alternations", 3))

        self.daily_meta = float(cfg.get("daily_profit_target", 1000.0))
        self.daily_stop = float(cfg.get("daily_stop_loss", 800.0))
        self.daily_trailing = bool(cfg.get("daily_trailing_enabled", True))
        self.daily_trigger = float(cfg.get("daily_trailing_trigger", 800.0))
        self.daily_giveback = float(cfg.get("daily_trailing_giveback", 250.0))

        self.engine = RenkoFlowEngine(box_points=self.box_pts, min_delta=self.min_delta)
        self.mae = None
        self.pirs = []
        self.trades = []
        
        self.max_profit_peak = 0.0
        self.locked_day = False
        self.lock_reason = ""
        self.accumulation_blocked_count = 0
        self.signals_total = 0

    def calcular_lucro_liquido_atual(self) -> float:
        pts_totais = sum(t["resultado_pts"] for t in self.trades)
        return pts_totais * VALOR_PONTO_WIN

    def _fechar(self, pos: dict, preco: float, hora: str, motivo: str):
        lado = 1 if pos["dir"] == "BUY" else -1
        pts = (preco - pos["preco"]) * lado - self.custo_pts
        res_pts = pts * pos["qtd"]
        self.trades.append({
            **pos,
            "saida": preco,
            "hora_saida": hora,
            "motivo": motivo,
            "pts": pts,
            "resultado_pts": res_pts
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

        # 1. Alvos das ordens da Pirâmide (+100 pts)
        restantes = []
        for p in self.pirs:
            hit_tp = (p["dir"] == "BUY" and preco >= p["alvo"]) or (p["dir"] == "SELL" and preco <= p["alvo"])
            if hit_tp:
                self._fechar(p, p["alvo"], hora, "TP_PIRAMIDE")
            else:
                restantes.append(p)
        self.pirs = restantes

        # 2. Checagem de Trava Diária de Capital (Lucro Líquido Realizado)
        if self.aplicar_travas:
            lucro_atual = self.calcular_lucro_liquido_atual()
            if lucro_atual > self.max_profit_peak:
                self.max_profit_peak = lucro_atual

            # 2a. Meta Diária Batida
            if self.daily_meta > 0 and lucro_atual >= self.daily_meta:
                self._zerar_tudo(preco, hora, f"META_DIARIA_BATIDA (R$ {lucro_atual:.2f})")
                self.locked_day = True
                self.lock_reason = f"🏆 META DIÁRIA ATINGIDA (R$ {lucro_atual:.2f} >= R$ {self.daily_meta:.2f})"
                return

            # 2b. Stop Diário Atingido
            if self.daily_stop > 0 and lucro_atual <= -self.daily_stop:
                self._zerar_tudo(preco, hora, f"STOP_DIARIO (R$ {lucro_atual:.2f})")
                self.locked_day = True
                self.lock_reason = f"🛑 STOP LOSS DIÁRIO ATINGIDO (R$ {lucro_atual:.2f} <= -R$ {self.daily_stop:.2f})"
                return

            # 2c. Trailing Stop Diário
            if self.daily_trailing and self.max_profit_peak >= self.daily_trigger:
                recuo = self.max_profit_peak - lucro_atual
                if recuo >= self.daily_trailing_giveback:
                    self._zerar_tudo(preco, hora, f"TRAILING_DIARIO (R$ {lucro_atual:.2f})")
                    self.locked_day = True
                    self.lock_reason = f"💰 TRAILING STOP DIÁRIO: Recuo de R$ {recuo:.2f} do pico R$ {self.max_profit_peak:.2f}"
                    return

        # 3. Zeragem obrigatória de fim de pregão (17:50)
        if hhmm >= "17:50":
            if self.mae or self.pirs:
                self._zerar_tudo(preco, hora, "FIM_PREGAO")
            self.locked_day = True
            self.lock_reason = "⏰ Fim da Janela Operacional (17:50)"
            return

        aggressor = "BUY" if agg > 0 else ("SELL" if agg < 0 else None)
        new_box, signal, reason = self.engine.process_tick(preco, vol, aggressor, hora)

        if not (signal and new_box):
            return

        self.signals_total += 1

        # Filtro de Horário para novas entradas (09:05 às 17:40)
        if not ("09:05" <= hhmm < "17:40"):
            return

        # 4. Filtro de Acumulação / Consolidação
        if self.acc_filter_enabled and len(self.engine.boxes) >= self.acc_window:
            is_acc, is_break, acc_reason, r_min, r_max = check_market_accumulation(
                self.engine.boxes,
                new_box,
                window_size=self.acc_window,
                max_alternations=self.acc_max_alt,
                min_range_mult=2.0,
                box_points=self.box_pts
            )
            if is_acc:
                self.accumulation_blocked_count += 1
                return

        # 5. Inversão de Fluxo: Zera posições contrárias
        dir_atual = self.mae["dir"] if self.mae else (self.pirs[0]["dir"] if self.pirs else None)
        if dir_atual and dir_atual != signal:
            self._zerar_tudo(preco, hora, f"INVERSAO_PARA_{signal}")

        # 6. Execução da Ordem Mãe ou Pirâmide
        if self.mae is None:
            self.mae = {
                "tipo": "MAE",
                "dir": signal,
                "preco": preco,
                "qtd": 1.0,
                "hora_entrada": hora,
                "alvo": None
            }
        elif len(self.pirs) < 15:
            alvo = preco + self.tp_pir if signal == "BUY" else preco - self.tp_pir
            self.pirs.append({
                "tipo": "PIRAMIDE",
                "dir": signal,
                "preco": preco,
                "alvo": alvo,
                "qtd": 1.0,
                "hora_entrada": hora
            })

    def finalizar(self, preco: float, hora: str):
        if self.mae or self.pirs:
            self._zerar_tudo(preco, hora, "FIM_SERIE")

    def resumo(self) -> dict:
        if not self.trades:
            return {
                "operacoes": 0, "pts": 0.0, "reais": 0.0, "acerto": 0.0,
                "max_dd_reais": 0.0, "profit_factor": 0.0, "bloqueados_acc": self.accumulation_blocked_count,
                "motivo_bloqueio": self.lock_reason
            }
        
        res_pts = np.array([t["resultado_pts"] for t in self.trades])
        res_reais = res_pts * VALOR_PONTO_WIN
        curva_reais = np.cumsum(res_reais)
        pico = np.maximum.accumulate(np.concatenate([[0], curva_reais]))[1:]
        dd_reais = float(np.max(pico - curva_reais))
        
        ganhos = res_reais[res_reais > 0].sum()
        perdas = abs(res_reais[res_reais < 0].sum())
        pf = (ganhos / perdas) if perdas > 0 else (99.0 if ganhos > 0 else 0.0)

        return {
            "operacoes": len(self.trades),
            "sinais": self.signals_total,
            "boxes": len(self.engine.boxes),
            "pts": float(res_pts.sum()),
            "reais": float(res_reais.sum()),
            "acerto": float((res_reais > 0).mean() * 100),
            "max_dd_reais": dd_reais,
            "profit_factor": float(pf),
            "pico_lucro": float(self.max_profit_peak),
            "bloqueados_acc": self.accumulation_blocked_count,
            "motivo_bloqueio": self.lock_reason or "Pregão concluído normalmente"
        }

def executar():
    cfg = carregar_config()
    print("=" * 80)
    print(f"📊 BACKTEST QUANTITATIVO B3 - RENKO {cfg.get('renko_r', 20)}R ({cfg.get('box_points', 100)} PONTOS)")
    print(f"Estratégia: Pirâmide & Confluência (TP Pirâmide: +{cfg.get('pyramid_tp_points', 100)} pts)")
    print(f"Meta Diária: R$ {cfg.get('daily_profit_target', 1000):.0f} | Stop Diário: R$ {cfg.get('daily_stop_loss', 800):.0f} | Trailing Lucro: R$ {cfg.get('daily_trailing_trigger', 800):.0f}")
    print(f"Filtro de Acumulação: {'ATIVADO' if cfg.get('accumulation_filter_enabled') else 'OFF'} (Janela: {cfg.get('accumulation_window_boxes', 6)} boxes)")
    print("=" * 80)

    from datetime import timedelta
    
    n_pregoes_alvo = 5
    pregoes_processados = []
    
    dia_cursor = datetime.now()
    dias_tentados = 0
    
    while len(pregoes_processados) < n_pregoes_alvo and dias_tentados < 15:
        if dias_tentados > 0:
            dia_cursor -= timedelta(days=1)
        dias_tentados += 1
        
        # Pula sábado e domingo
        if dia_cursor.weekday() >= 5:
            continue
            
        d_str = dia_cursor.strftime("%Y-%m-%d")
        df, info = web_app.buscar_ticks_historicos("WINZ26", d_str, num_ticks=None)
        if df is None or len(df) == 0:
            continue
            
        # Evita duplicar o mesmo dia se o fallback do MT5 retornar a mesma data
        if any(p["info"] == info for p in pregoes_processados):
            continue
            
        ticks = preparar_ticks(df)
        pregoes_processados.append({
            "data_str": d_str,
            "info": info,
            "ticks": ticks
        })
        print(f"📥 Coletado pregão {info} ({len(ticks['preco']):,} ticks)")

    print(f"\n🚀 Iniciando simulação tick-a-tick em {len(pregoes_processados)} pregões...\n")

    resumos_prot = []
    resumos_livre = []

    for item in pregoes_processados:
        info = item["info"]
        ticks = item["ticks"]
        print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print(f"📅 Pregão: {info} ({len(ticks['preco']):,} ticks)")

        # Execução 1: Com Proteção de Risco Completa (Safety Locks do renko_config.json)
        bt_protegido = BacktestInstitucional20R(cfg, aplicar_travas_diarias=True, custo_pts=5.0)
        for i in range(len(ticks["preco"])):
            bt_protegido.on_tick(ticks["preco"][i], ticks["vol"][i], int(ticks["agg"][i]), ticks["hora"][i])
        bt_protegido.finalizar(ticks["preco"][-1], ticks["hora"][-1])
        r_prot = bt_protegido.resumo()
        r_prot["info"] = info
        resumos_prot.append(r_prot)

        # Execução 2: Sem Travas Diárias (Controle Comparativo)
        bt_livre = BacktestInstitucional20R(cfg, aplicar_travas_diarias=False, custo_pts=5.0)
        for i in range(len(ticks["preco"])):
            bt_livre.on_tick(ticks["preco"][i], ticks["vol"][i], int(ticks["agg"][i]), ticks["hora"][i])
        bt_livre.finalizar(ticks["preco"][-1], ticks["hora"][-1])
        r_livre = bt_livre.resumo()
        r_livre["info"] = info
        resumos_livre.append(r_livre)

        print(f"🛡️  [COM GESTÃO DE RISCO 20R]:")
        print(f"   Resultado Líquido : R$ {r_prot['reais']:+,.2f} ({r_prot['pts']:+,.0f} pts) | Acerto: {r_prot['acerto']:.1f}% ({r_prot['operacoes']} ops)")
        print(f"   Filtro Acumulação : {r_prot['bloqueados_acc']} falsos rompimentos barrados")
        print(f"   Encerramento      : {r_prot['motivo_bloqueio']}")

        print(f"⚠️  [SEM TRAVAS (LIVRE)]:")
        print(f"   Resultado Líquido : R$ {r_livre['reais']:+,.2f} ({r_livre['pts']:+,.0f} pts) | Acerto: {r_livre['acerto']:.1f}% ({r_livre['operacoes']} ops)")

    # ── RELATÓRIO CONSOLIDADO MULTI-PREGÃO ──
    print("\n" + "=" * 80)
    print("🏆 RELATÓRIO CONSOLIDADO MULTI-PREGÃO (5 PREGÕES B3)")
    print("=" * 80)

    total_reais_prot = sum(r["reais"] for r in resumos_prot)
    total_reais_livre = sum(r["reais"] for r in resumos_livre)
    total_ops_prot = sum(r["operacoes"] for r in resumos_prot)
    total_ops_livre = sum(r["operacoes"] for r in resumos_livre)
    total_bloq_acc = sum(r["bloqueados_acc"] for r in resumos_prot)
    dias_gain_prot = sum(1 for r in resumos_prot if r["reais"] > 0)
    dias_gain_livre = sum(1 for r in resumos_livre if r["reais"] > 0)

    print(f"\n📊 COMPARATIVO GERAL ACUMULADO:")
    print(f"{'Métrica':<30} | {'COM GESTÃO DE RISCO':<22} | {'SEM TRAVAS (LIVRE)':<20}")
    print("-" * 80)
    print(f"{'Resultado Líquido Total':<30} | R$ {total_reais_prot:+,.2f}             | R$ {total_reais_livre:+,.2f}")
    print(f"{'Total de Operações':<30} | {total_ops_prot} trades               | {total_ops_livre} trades")
    print(f"{'Dias Positivos / Total':<30} | {dias_gain_prot} de {len(resumos_prot)} dias           | {dias_gain_livre} de {len(resumos_livre)} dias")
    print(f"{'Filtro de Acumulação':<30} | {total_bloq_acc} caixotes evitados    | 0 (desativado)")
    print("-" * 80)

    print(f"\n📋 DETALHAMENTO DIÁRIO (COM GESTÃO DE RISCO):")
    print(f"{'Pregão':<14} | {'Trades':<8} | {'Acerto':<8} | {'Resultado R$':<15} | {'Status Encerramento'}")
    print("-" * 80)
    for r in resumos_prot:
        print(f"{r['info']:<14} | {r['operacoes']:<8} | {r['acerto']:>5.1f}%  | R$ {r['reais']:>10,.2f}    | {r['motivo_bloqueio']}")
    print("-" * 80)

if __name__ == "__main__":
    executar()
