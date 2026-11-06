import sys
import MetaTrader5 as mt5
from datetime import datetime

# O console do Windows é cp850/cp1252 e morre em UnicodeEncodeError ao imprimir travessão
# com a saída redirecionada — que é exatamente o modo como log, launcher e agente rodam isto.
# Forçar UTF-8 no stdout é o que faz o mesmo script valer nas duas máquinas sem perder acento.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

if not mt5.initialize():
    print("Erro MT5")
    exit()

def carregar_historico_renko(symbol="WINZ26", box_pts=100, max_dias=2):
    rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 1500)
    if rates is None or len(rates) == 0:
        return []

    dias = {}
    for r in rates:
        d = datetime.fromtimestamp(r["time"]).strftime("%Y-%m-%d")
        if d not in dias:
            dias[d] = []
        dias[d].append(r)

    dias_ordenados = sorted(dias.keys())[-max_dias:]
    todos_boxes = []
    prev_close = None
    cvd_acc = 0.0

    for d in dias_ordenados:
        r_list = dias[d]
        open_day = round(r_list[0]["open"] / 5.0) * 5.0
        gap_pts = 0.0
        is_gap = False
        if prev_close is not None:
            gap_pts = open_day - prev_close
            if abs(gap_pts) >= (box_pts * 1.5):
                is_gap = True

        curr_dir = "UP"
        last_close = open_day
        day_boxes = []
        d_formatado = datetime.strptime(d, "%Y-%m-%d").strftime("%d/%m")

        for r in r_list:
            o, h, l, c = r["open"], r["high"], r["low"], r["close"]
            vol = float(r["tick_volume"])
            t_ms = int(r["time"]) * 1000
            delta_bar = vol * 0.4 if c > o else (-vol * 0.4 if c < o else 0.0)

            pts_seq = [o, l, h, c] if c >= o else [o, h, l, c]
            for p in pts_seq:
                if curr_dir == "UP":
                    if p >= last_close + box_pts:
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "UP",
                            "open": last_close,
                            "close": last_close + box_pts,
                            "high": last_close + box_pts,
                            "low": last_close,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.7 if delta_bar > 0 else vol * 0.3),
                            "sellVolume": int(vol * 0.3 if delta_bar > 0 else vol * 0.7),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close += box_pts
                    elif p <= last_close - (box_pts * 2):
                        curr_dir = "DOWN"
                        prev_o = last_close - box_pts
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "DOWN",
                            "open": prev_o,
                            "close": prev_o - box_pts,
                            "high": prev_o,
                            "low": prev_o - box_pts,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.3),
                            "sellVolume": int(vol * 0.7),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close = prev_o - box_pts
                else:
                    if p <= last_close - box_pts:
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "DOWN",
                            "open": last_close,
                            "close": last_close - box_pts,
                            "high": last_close,
                            "low": last_close - box_pts,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.3),
                            "sellVolume": int(vol * 0.7),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close -= box_pts
                    elif p >= last_close + (box_pts * 2):
                        curr_dir = "UP"
                        prev_o = last_close + box_pts
                        cvd_acc += delta_bar
                        day_boxes.append({
                            "index": len(todos_boxes) + len(day_boxes),
                            "direction": "UP",
                            "open": prev_o,
                            "close": prev_o + box_pts,
                            "high": prev_o + box_pts,
                            "low": prev_o,
                            "timeStart": t_ms,
                            "timeEnd": t_ms,
                            "ticksCount": int(vol),
                            "totalVolume": int(vol),
                            "buyVolume": int(vol * 0.7),
                            "sellVolume": int(vol * 0.3),
                            "delta": round(delta_bar),
                            "cvdAtClose": round(cvd_acc),
                            "isConvergence": False
                        })
                        last_close = prev_o + box_pts

        if day_boxes:
            day_boxes[0]["isDayStart"] = True
            day_boxes[0]["dayLabel"] = d_formatado
            if is_gap:
                day_boxes[0]["isGap"] = True
                day_boxes[0]["gapPoints"] = gap_pts
            prev_close = day_boxes[-1]["close"]
            todos_boxes.extend(day_boxes)

    return todos_boxes

if __name__ == "__main__":
    boxes = carregar_historico_renko("WINZ26", box_pts=100, max_dias=2)
    print(f"Sucesso! Total de boxes gerados: {len(boxes)}")
    for b in boxes:
        if b.get("isDayStart"):
            gap_txt = f" | GAP: {b.get('gapPoints', 0):+.0f} pts" if b.get("isGap") else " | Sem Gap Relevante"
            print(f"Dia {b.get('dayLabel')} - Box #{b['index']} Preço {b['open']:.0f}{gap_txt}")
