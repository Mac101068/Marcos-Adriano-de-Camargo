"""
Backtest tick-a-tick da estratégia Renko 10R + Pirâmide de Confluência.

Replica as regras do MT5PyramidOrderManager (execução ao vivo):
  - Só age em SINAL (box fechado + delta >= filtro), dentro da janela de entradas.
  - Sinal contrário à posição -> zera tudo (mãe + pirâmides) e abre nova mãe.
  - Mãe: sem TP/SL, sai só na inversão ou na zeragem do dia.
  - Pirâmide: TP fixo (+50 pts). Ao bater o alvo, sai e libera vaga (limite de N abertas).
  - Zeragem obrigatória no horário configurado.

Premissas (otimistas, documentadas): entrada a mercado no preço do tick que fechou o box,
TP preenchido exatamente no alvo, custo/escorregamento modelado por `custo_pts` por operação.
"""
from typing import List, Dict, Any, Optional
import numpy as np
import pandas as pd

from fluxo_atemporal_modulo import RenkoFlowEngine
from config import (
    RENKO_BOX_PTS, PYRAMID_TP_PTS, MAX_POSICOES_PIRAMIDE, CONTRATOS_MAE, CONTRATOS_PIRAMIDE,
    HORA_INICIO_TRADING, HORA_FIM_ENTRADAS, HORA_ZERAGEM_OBRIGATORIA,
)

VALOR_PONTO_WIN = 0.20  # R$ por ponto por contrato do Mini-Índice


def preparar_ticks(df: pd.DataFrame) -> Dict[str, np.ndarray]:
    """Converte DataFrame de ticks (MT5 ou CSV) em arrays: preço, volume, agressor, hora."""
    df = df.copy()
    preco_col = 'last' if 'last' in df.columns else 'price'
    df = df[pd.to_numeric(df[preco_col], errors='coerce') > 0]
    preco = df[preco_col].to_numpy(dtype=float)

    vol = np.ones(len(df))
    if 'volume_real' in df.columns:
        vol = df['volume_real'].fillna(0).to_numpy(dtype=float)
    if 'volume' in df.columns:
        v2 = df['volume'].fillna(0).to_numpy(dtype=float)
        vol = np.where(vol > 0, vol, v2)
    vol = np.where(vol > 0, vol, 1.0)

    flags = df['flags'].fillna(0).to_numpy(dtype=np.int64) if 'flags' in df.columns else np.zeros(len(df), dtype=np.int64)
    bid = df['bid'].fillna(0).to_numpy(dtype=float) if 'bid' in df.columns else np.zeros(len(df))
    ask = df['ask'].fillna(0).to_numpy(dtype=float) if 'ask' in df.columns else np.zeros(len(df))
    f_buy = (flags & 32) > 0
    f_sell = (flags & 64) > 0
    agg = np.where(f_buy & ~f_sell, 1, np.where(f_sell & ~f_buy, -1,
                   np.where((ask > 0) & (preco >= ask), 1, np.where((bid > 0) & (preco <= bid), -1, 0))))

    if 'time' in df.columns:
        # MT5 timestamps estão em UTC (09:00 Brasília = 12:00 UTC). Subtrai 3h para obter horário local de Brasília.
        horas = pd.to_datetime(df['time'].to_numpy() - 10800, unit='s').strftime('%H:%M:%S').to_numpy()
    else:
        horas = np.array(['12:00:00'] * len(df))
    return {'preco': preco, 'vol': vol, 'agg': agg, 'hora': horas}



class BacktestPiramide:
    def __init__(self, min_delta: float, box_pts: int = RENKO_BOX_PTS, tp_pir: float = PYRAMID_TP_PTS,
                 max_pir: int = MAX_POSICOES_PIRAMIDE, ctr_mae: float = CONTRATOS_MAE,
                 ctr_pir: float = CONTRATOS_PIRAMIDE, custo_pts: float = 0.0,
                 hora_ini: str = HORA_INICIO_TRADING, hora_fim: str = HORA_FIM_ENTRADAS,
                 hora_zerar: str = HORA_ZERAGEM_OBRIGATORIA):
        self.engine = RenkoFlowEngine(box_points=box_pts, min_delta=min_delta)
        self.tp_pir, self.max_pir = tp_pir, max_pir
        self.ctr_mae, self.ctr_pir, self.custo = ctr_mae, ctr_pir, custo_pts
        self.hora_ini, self.hora_fim, self.hora_zerar = hora_ini, hora_fim, hora_zerar
        self.mae: Optional[Dict[str, Any]] = None
        self.pirs: List[Dict[str, Any]] = []
        self.trades: List[Dict[str, Any]] = []
        self.sinais = 0
        self.zerado_dia = False

    # ── posições ──
    def _fechar(self, pos: Dict[str, Any], preco: float, hora: str, motivo: str):
        lado = 1 if pos['dir'] == 'BUY' else -1
        pts = (preco - pos['preco']) * lado - self.custo
        self.trades.append({**pos, 'saida': preco, 'hora_saida': hora, 'motivo': motivo,
                            'pts': pts, 'resultado_pts': pts * pos['qtd']})

    def _zerar_tudo(self, preco: float, hora: str, motivo: str):
        if self.mae:
            self._fechar(self.mae, preco, hora, motivo)
            self.mae = None
        for p in self.pirs:
            self._fechar(p, preco, hora, motivo)
        self.pirs = []

    def on_tick(self, preco: float, vol: float, agg: int, hora: str) -> List[str]:
        eventos: List[str] = []
        hhmm = hora[:5]

        # 1) Alvos das pirâmides (ordens TP no book)
        restantes = []
        for p in self.pirs:
            if (p['dir'] == 'BUY' and preco >= p['alvo']) or (p['dir'] == 'SELL' and preco <= p['alvo']):
                self._fechar(p, p['alvo'], hora, 'TP')
                eventos.append(f"🎯 TP pirâmide {p['dir']} @ {p['alvo']:.0f}")
            else:
                restantes.append(p)
        self.pirs = restantes

        # 2) Zeragem obrigatória
        if hhmm >= self.hora_zerar:
            if not self.zerado_dia and (self.mae or self.pirs):
                self._zerar_tudo(preco, hora, 'ZERAGEM')
                eventos.append(f"⏰ Zeragem obrigatória @ {preco:.0f}")
            self.zerado_dia = True
            return eventos

        aggressor = 'BUY' if agg > 0 else ('SELL' if agg < 0 else None)
        new_box, signal, reason = self.engine.process_tick(preco, vol, aggressor, hora)
        if not (signal and new_box):
            return eventos
        self.sinais += 1
        if not (self.hora_ini <= hhmm < self.hora_fim):
            return eventos

        # 3) Inversão
        dir_atual = self.mae['dir'] if self.mae else (self.pirs[0]['dir'] if self.pirs else None)
        if dir_atual and dir_atual != signal:
            n = len(self.pirs)
            self._zerar_tudo(preco, hora, 'INVERSAO')
            eventos.append(f"🔄 Inversão: zerado {dir_atual} (mãe + {n} pirâmides) @ {preco:.0f}")

        # 4) Mãe ou pirâmide
        if self.mae is None:
            self.mae = {'tipo': 'MAE', 'dir': signal, 'preco': preco, 'qtd': self.ctr_mae, 'hora_entrada': hora}
            eventos.append(f"🟢 {signal} MÃE @ {preco:.0f} | {reason}")
        elif len(self.pirs) < self.max_pir:
            alvo = preco + self.tp_pir if signal == 'BUY' else preco - self.tp_pir
            self.pirs.append({'tipo': 'PIR', 'dir': signal, 'preco': preco, 'alvo': alvo,
                              'qtd': self.ctr_pir, 'hora_entrada': hora})
            eventos.append(f"🔺 {signal} PIRÂMIDE ({len(self.pirs)}/{self.max_pir}) @ {preco:.0f} alvo {alvo:.0f}")
        return eventos

    def finalizar(self, preco: float, hora: str):
        self._zerar_tudo(preco, hora, 'FIM_DADOS')

    def resumo(self) -> Dict[str, Any]:
        if not self.trades:
            return {'operacoes': 0, 'sinais': self.sinais, 'pts': 0.0, 'reais': 0.0,
                    'acerto': 0.0, 'max_dd_pts': 0.0, 'boxes': len(self.engine.boxes)}
        res = np.array([t['resultado_pts'] for t in self.trades])
        curva = np.cumsum(res)
        dd = float(np.max(np.maximum.accumulate(np.concatenate([[0], curva]))[1:] - curva))
        return {
            'operacoes': len(self.trades),
            'sinais': self.sinais,
            'boxes': len(self.engine.boxes),
            'pts': float(res.sum()),
            'reais': float(res.sum() * VALOR_PONTO_WIN),
            'acerto': float((res > 0).mean() * 100),
            'max_dd_pts': dd,
            'pts_mae': float(sum(t['resultado_pts'] for t in self.trades if t['tipo'] == 'MAE')),
            'pts_pir': float(sum(t['resultado_pts'] for t in self.trades if t['tipo'] == 'PIR')),
        }


def rodar_backtest(ticks: Dict[str, np.ndarray], min_delta: float, custo_pts: float = 0.0, **kw) -> BacktestPiramide:
    bt = BacktestPiramide(min_delta=min_delta, custo_pts=custo_pts, **kw)
    preco, vol, agg, hora = ticks['preco'], ticks['vol'], ticks['agg'], ticks['hora']
    for k in range(len(preco)):
        bt.on_tick(preco[k], vol[k], int(agg[k]), hora[k])
    if len(preco):
        bt.finalizar(preco[-1], hora[-1])
    return bt
