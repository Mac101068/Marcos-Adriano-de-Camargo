"""

========================================================================================

MOTOR DE BACKTEST QUANTITATIVO: TICKS REAIS B3 (XP METATRADER 5)

========================================================================================

Exporta e executa backtest tick-a-tick com precisão de agressão (BUY/SELL)

e cálculo oficial de Pontos/Ticks do Mini-Índice B3 (WINZ26 / WIN$).

========================================================================================

"""



import sys

import os

import json

import argparse

from datetime import datetime, timedelta

import MetaTrader5 as mt5



if hasattr(sys.stdout, 'reconfigure'):

    sys.stdout.reconfigure(encoding='utf-8')



# Constantes do Ativo Mini-Índice B3

POINT_VALUE = 0.20   # R$ 0,20 por ponto por minicontrato

TICK_SIZE = 5.0      # 1 tick = 5 pontos = R$ 1,00



def list_available_pregoes(symbol="WINZ26", max_days=35):

    """Varre e lista os pregões que contêm histórico de ticks reais disponíveis na corretora."""

    if not mt5.initialize():

        print("[ERRO] Não foi possível conectar ao MetaTrader 5.")

        return []

    

    now = datetime.now()

    available = []

    print(f"\n🔍 Varrendo pregões com histórico de ticks reais em '{symbol}'...")

    

    for d in range(0, max_days):

        day_start = datetime(now.year, now.month, now.day) - timedelta(days=d)

        day_end = day_start + timedelta(days=1) - timedelta(seconds=1)

        if day_start.weekday() >= 5:

            continue

        ticks = mt5.copy_ticks_range(symbol, day_start, day_end, mt5.COPY_TICKS_ALL)

        cnt = len(ticks) if ticks is not None else 0

        date_str = day_start.strftime("%Y-%m-%d")

        weekday_name = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"][day_start.weekday()]

        if cnt > 1000:

            available.append({"date": date_str, "weekday": weekday_name, "ticks": cnt})

            print(f"  📅 {date_str} ({weekday_name}): {cnt:,} ticks reais")

            

    mt5.shutdown()

    return available



def run_backtest_date(target_date_str, symbol="WINZ26", renko_r=10, strategy="PYRAMID"):

    """

    Executa o motor de backtest tick-a-tick fiel à estratégia do terminal:

    - Suporte a Mini-Índice (WIN), Mini-Dólar (WDO) e Bitcoin B3 (BIT/BTCBR)

    - Ordem Mãe surfa até a reversão total de fluxo

    - Ordens de Pirâmide a cada box consecutivo com Take Profit de +1 box

    """

    if not mt5.initialize():

        print("[ERRO] Falha ao inicializar MT5.")

        return None



    sym_upper = symbol.upper()

    is_wdo = "WDO" in sym_upper or "DOL" in sym_upper

    is_btc = "BIT" in sym_upper or "BTC" in sym_upper



    if is_wdo:

        point_value = 10.0

        tick_size = 0.5

        box_points = renko_r * tick_size

    elif is_btc:

        point_value = 0.1

        tick_size = 20.0

        box_points = renko_r * tick_size

    else:

        point_value = 0.20

        tick_size = 5.0

        box_points = renko_r * tick_size

    print(f"\n================================================================================")

    print(f"🚀 INICIANDO BACKTEST COM TICKS REAIS: {target_date_str}")

    print(f"Ativo: {symbol} | Escala: {renko_r}R ({box_points:.1f} pts) | Estratégia: Pirâmide & Confluência")

    print(f"================================================================================")

    

    is_csv = target_date_str.endswith(".csv") or "data/" in target_date_str or "data\\" in target_date_str

    if is_csv:

        csv_path = target_date_str

        if not os.path.isabs(csv_path) and not os.path.exists(csv_path):

            for candidate_dir in [r"C:\Users\Lucas\Documents\RoboFluxoB3", r"C:\Users\Lucas\Documents\robo_renko"]:

                cand = os.path.join(candidate_dir, csv_path)

                if os.path.exists(cand):

                    csv_path = cand

                    break

        print(f"📂 Carregando ticks do arquivo CSV: {csv_path}...", flush=True)

        import pandas as pd

        df = pd.read_csv(csv_path).dropna(subset=['time_msc'])

        if 'last' in df.columns:

            df['last'] = df['last'].replace(0, pd.NA).fillna(df['bid'])

        ticks = df.to_dict('records')

    else:

        if not mt5.initialize():

            print("[ERRO] Falha ao inicializar MT5.")

            return None

        day_start = datetime.strptime(target_date_str, "%Y-%m-%d")

        day_end = day_start + timedelta(days=1) - timedelta(seconds=1)

        print("⏳ Carregando fluxo de negócios reais da B3...", flush=True)

        ticks = mt5.copy_ticks_range(symbol, day_start, day_end, mt5.COPY_TICKS_ALL)

        mt5.shutdown()

    

    if ticks is None or len(ticks) == 0:

        print(f"❌ Nenhum tick encontrado para a data {target_date_str} no ativo {symbol}.")

        return None

    

    total_ticks = len(ticks)

    print(f"✅ {total_ticks:,} ticks reais carregados. Processando formação dos blocos Renko...", flush=True)

    

    boxes = []

    current_box = None

    cvd = 0.0

    

    # Motor de Renko Atemporal

    for t in ticks:

        flags = int(t['flags'])

        vol = int(t.get('volume') or t.get('volume_real', 1) or 1) if isinstance(t, dict) else int(t['volume'] or 1)

        price = float(t['last'] if t['last'] > 0 else (t['bid'] if t['bid'] > 0 else t['ask']))

        if price <= 0:

            continue

            

        aggressor = "BUY" if (flags & 32) else ("SELL" if (flags & 64) else "CROSS")

        tick_delta = vol if aggressor == "BUY" else (-vol if aggressor == "SELL" else 0)

        cvd += tick_delta

        

        t_msc = int(t['time_msc'])

        

        if current_box is None:

            base_p = round(price / tick_size) * tick_size

            current_box = {

                "open": base_p, "close": base_p, "high": base_p, "low": base_p,

                "buy_vol": 0, "sell_vol": 0, "delta": 0, "ticks": 0, "time_start": t_msc

            }

            continue

            

        current_box["ticks"] += 1

        if aggressor == "BUY": current_box["buy_vol"] += vol

        elif aggressor == "SELL": current_box["sell_vol"] += vol

        current_box["delta"] = current_box["buy_vol"] - current_box["sell_vol"]

        current_box["high"] = max(current_box["high"], price)

        current_box["low"] = min(current_box["low"], price)

        current_box["close"] = price

        

        last_dir = boxes[-1]["direction"] if boxes else "UP"

        last_close = boxes[-1]["close"] if boxes else current_box["open"]

        

        new_box = None

        if last_dir == "UP":

            if price >= last_close + box_points:

                new_box = {

                    "index": len(boxes), "direction": "UP",

                    "open": last_close, "close": last_close + box_points,

                    "delta": current_box["delta"], "cvd": cvd, "time": t_msc

                }

            elif price <= last_close - (box_points * 2):

                prev_open = boxes[-1]["open"] if boxes else (last_close - box_points)

                new_box = {

                    "index": len(boxes), "direction": "DOWN",

                    "open": prev_open, "close": prev_open - box_points,

                    "delta": current_box["delta"], "cvd": cvd, "time": t_msc

                }

        else:

            if price <= last_close - box_points:

                new_box = {

                    "index": len(boxes), "direction": "DOWN",

                    "open": last_close, "close": last_close - box_points,

                    "delta": current_box["delta"], "cvd": cvd, "time": t_msc

                }

            elif price >= last_close + (box_points * 2):

                prev_open = boxes[-1]["open"] if boxes else (last_close + box_points)

                new_box = {

                    "index": len(boxes), "direction": "UP",

                    "open": prev_open, "close": prev_open + box_points,

                    "delta": current_box["delta"], "cvd": cvd, "time": t_msc

                }

                

        if new_box:

            boxes.append(new_box)

            current_box = {

                "open": new_box["close"], "close": price, "high": price, "low": price,

                "buy_vol": 0, "sell_vol": 0, "delta": 0, "ticks": 0, "time_start": t_msc

            }



    print(f"📊 Total de Boxes {renko_r}R formados: {len(boxes)}")

    

    # Simulação de Ordens

    trades = []

    open_orders = []

    total_pnl = 0.0

    gross_profit = 0.0

    gross_loss = 0.0

    wins = 0

    losses = 0

    

    for i, b in enumerate(boxes):

        direction = b["direction"]

        close_p = b["close"]

        prev_dir = boxes[i-1]["direction"] if i > 0 else None

        

        # 1. Virada de fluxo -> Encerra posições contrárias

        if prev_dir is not None and direction != prev_dir:

            for ord in open_orders:

                pts = (close_p - ord["entry"]) if ord["side"] == "BUY" else (ord["entry"] - close_p)

                res = pts * point_value

                total_pnl += res

                if res >= 0:

                    wins += 1

                    gross_profit += res

                else:

                    losses += 1

                    gross_loss += abs(res)

                trades.append({

                    "role": ord["role"], "side": ord["side"],

                    "entry": ord["entry"], "exit": close_p, "pts": pts, "brl": res, "reason": "INVERSAO"

                })

            open_orders = []

            

            # Abre nova Mãe

            open_orders.append({

                "role": "MAE", "side": "BUY" if direction == "UP" else "SELL", "entry": close_p, "tp": None

            })

        else:

            # Continuidade -> Executa TP de pirâmides e abre novas

            rem = []

            for ord in open_orders:

                if ord["role"] == "PIRAMIDE":

                    res = box_points * point_value

                    total_pnl += res

                    wins += 1

                    gross_profit += res

                    trades.append({

                        "role": "PIRAMIDE", "side": ord["side"],

                        "entry": ord["entry"], "exit": ord["tp"], "pts": box_points, "brl": res, "reason": "TP_ATINGIDO"

                    })

                else:

                    rem.append(ord)

            open_orders = rem

            

            # Nova pirâmide

            tp_p = (close_p + box_points) if direction == "UP" else (close_p - box_points)

            open_orders.append({

                "role": "PIRAMIDE", "side": "BUY" if direction == "UP" else "SELL", "entry": close_p, "tp": tp_p

            })

            

    # Fecha ordens restantes no final do dia

    if open_orders and boxes:

        last_p = boxes[-1]["close"]

        for ord in open_orders:

            pts = (last_p - ord["entry"]) if ord["side"] == "BUY" else (ord["entry"] - last_p)

            res = pts * point_value

            total_pnl += res

            if res >= 0: wins += 1; gross_profit += res

            else: losses += 1; gross_loss += abs(res)

            trades.append({

                "role": ord["role"], "side": ord["side"],

                "entry": ord["entry"], "exit": last_p, "pts": pts, "brl": res, "reason": "FIM_PREGAO"

            })



    total_ops = len(trades)

    win_rate = (wins / total_ops * 100) if total_ops else 0

    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 999.0

    

    print("\n" + "="*80)

    print(f"📈 RESULTADO CONSOLIDADO DO PREGÃO ({target_date_str}):")

    print(f"  • Total de Operações: {total_ops}")

    print(f"  • Taxa de Acerto (Win Rate): {win_rate:.1f}% ({wins} gains / {losses} losses)")

    print(f"  • Lucro Bruto: +R$ {gross_profit:,.2f}")

    print(f"  • Prejuízo Bruto: -R$ {gross_loss:,.2f}")

    print(f"  • Fator de Lucro (Profit Factor): {profit_factor:.2f}")

    print(f"  • RESULTADO LÍQUIDO DO DIA: R$ {total_pnl:+,.2f} {'🟢' if total_pnl >= 0 else '🔴'}")

    print("="*80 + "\n")

    

    return {

        "date": target_date_str,

        "symbol": symbol,

        "renko_r": renko_r,

        "ticks": total_ticks,

        "boxes": len(boxes),

        "total_ops": total_ops,

        "wins": wins,

        "losses": losses,

        "win_rate": round(win_rate, 1),

        "pnl": round(total_pnl, 2),

        "profit_factor": round(profit_factor, 2)

    }



if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Motor de Backtest Tick-a-Tick B3")

    parser.add_argument("--date", type=str, help="Data no formato AAAA-MM-DD (ex: 2026-11-04)")

    parser.add_argument("--r", type=int, default=10, help="Tamanho do Renko em R (padrão: 10)")

    parser.add_argument("--symbol", type=str, default="WINZ26", help="Ativo alvo (padrão: WINZ26)")

    parser.add_argument("--list", action="store_true", help="Lista todos os pregões com ticks reais disponíveis")

    

    args = parser.parse_args()

    

    if args.list:

        list_available_pregoes(symbol=args.symbol)

    elif args.date:

        run_backtest_date(args.date, symbol=args.symbol, renko_r=args.r)

    else:

        # Padrão: roda a data de ontem (2026-11-03)

        run_backtest_date("2026-11-03", symbol=args.symbol, renko_r=args.r)



