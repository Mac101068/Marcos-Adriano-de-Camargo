"""Auditoria de UM pregão: o que a ponte viu × o que reproduzimos × o que a corretora fez.

Três perguntas diferentes, três seções no relatório:

  FIDELIDADE  — os boxes que a ponte fechou ao vivo são os mesmos que a reprodução offline
                fecha com os ticks gravados? Se não bater, a reprodução não conta história e o
                backtest é ficção. Alinhamos pelo carimbo exato do tick (ts_msc).

  REAL        — o extrato de negócios da conta (deals): PnL, comissão e quem de fato operou
                (magic do robô × magic 0 = mão do operador). É a única fonte de verdade.

  REPRODUZIDO — quantos sinais o motor produziria e quanto valeriam, com o modelo de saída da
                própria pirâmide (mãe segura até inversão, pirâmide com TP de 1 box).

O modelo de saída é uma ESTIMATIVA declarada: ele não conhece slippage nem recusa da
corretora, porque opera sobre o preço de fechamento do box. Ele serve para comparar pregões
entre si e contra os deals reais, não como extrato contábil.

Uso:
    .\\venv\\Scripts\\python.exe auditar_pregao.py --dia 20261104
    .\\venv\\Scripts\\python.exe auditar_pregao.py --dia 20261105 --coletar-deals
"""

import argparse
import csv
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bot_mt5_ciclo15 as ponte
from auditoria_diario import (
    PASTA_AUDITORIA,
    carregar_eventos,
    salvar_deals_mt5,
)

RAIZ = os.path.dirname(os.path.abspath(__file__))
MAGICS_ROBO = {int(v["magic"]) for v in ponte.SUPPORTED_ASSETS.values()} | {int(ponte.MAGIC_NUMBER)}


def carregar_csv_trilha(nome, dia, simbolo=None):
    """Lê ordens_/deals_ de um pregão; tolera arquivo inexistente e schema antigo."""
    sufixo = f"_{simbolo}" if simbolo else ""
    caminho = os.path.join(PASTA_AUDITORIA, f"{nome}{sufixo}_{dia}.csv")
    if not os.path.exists(caminho):
        caminho = os.path.join(PASTA_AUDITORIA, f"{nome}_{dia}.csv")
    if not os.path.exists(caminho):
        return [], caminho
    with open(caminho, encoding="utf-8") as f:
        return list(csv.DictReader(f)), caminho


def coletar_deals(dia):
    """Puxa o extrato REAL do MT5 para o dia e grava em data/auditoria/deals_<DIA>.csv."""
    if not ponte.mt5.initialize(path=ponte.MT5_PATH):
        print(f"❌ MT5 indisponível ({ponte.mt5.last_error()}) — ligue o terminal da XP para coletar deals.")
        return None
    try:
        inicio = int(datetime.strptime(dia, "%Y%m%d").timestamp())
        deals = ponte.mt5.history_deals_get(inicio, inicio + 86400)
        # history_deals_get devolve ndarray estruturado: nunca usar `ou []` aqui
        lista = [] if deals is None else list(deals)
        caminho = salvar_deals_mt5(lista, None, dia)
        print(f" 🧾 deals reais de {dia}: {len(lista)} negócio(s) → {os.path.basename(caminho)}")
        return lista
    finally:
        ponte.mt5.shutdown()


def chave_box(r):
    """Chave de alinhamento VIVO × REPRO.

    O carimbo exato (ts_msc) é o ideal, mas as linhas gravadas antes do schema novo não o têm,
    e uma comparação misturada por chave diferente sempre daria zero correspondências. Então a
    chave é o instante de fechamento em segundos + o preço do box: dois lados que viram o mesmo
    tick colapsam na mesma chave, e boxes distintos não.
    """
    return f"{r.get('data')} {r.get('hora')}|{r.get('fechamento')}"


def auditar_fidelidade(ativo, dia, detalhar=False):
    vivo = carregar_eventos(dia=dia, simbolo=ativo, fonte="VIVO")
    repro = carregar_eventos(dia=dia, simbolo=ativo, fonte="REPRO")
    print(f"\n──────── FIDELIDADE {ativo} {dia} ────────")
    if not vivo or not repro:
        print(f"   boxes VIVO={len(vivo)} REPRO={len(repro)} —")
        print("   sem as duas trilhas no mesmo pregão, a comparação não pode ser feita."
              " Falta diário vivo (processo antigo) ou recorte de ticks do dia.")
        return None
    por_v = {chave_box(r): r for r in vivo}
    por_r = {chave_box(r): r for r in repro}
    comuns = sorted(set(por_v) & set(por_r))
    divergens = [k for k in comuns if por_v[k]["sinal"] != por_r[k]["sinal"]]
    direcao_div = [k for k in comuns if por_v[k]["direcao"] != por_r[k]["direcao"]]
    delta_div = [k for k in comuns if por_v[k]["delta"] != por_r[k]["delta"]]
    print(f"   VIVO {len(por_v)} boxes | REPRO {len(por_r)} boxes | alinhados por tick: {len(comuns)}")
    print(f"   sinais divergentes: {len(divergens)} | direção divergente: {len(direcao_div)} | delta divergente: {len(delta_div)}")
    for k in divergens[:5]:
        print(f"     ⚠️  {k}: vivo={por_v[k]['sinal'] or 'CALADO'} ({por_v[k]['motivo']}) "
              f"× repro={por_r[k]['sinal'] or 'CALADO'} ({por_r[k]['motivo']})")
    if detalhar:
        colunas = ("box_index", "direcao", "abertura", "fechamento", "delta",
                   "volume_compra", "volume_venda", "ticks", "limiar_compra", "sinal")
        print("\n   lado a lado (VIVO | REPRO) dos boxes alinhados por instante+preço:")
        print("     " + f"{'chave':<26}" + "".join(f"{c[:9]:>12}" for c in colunas) + "        <<< vivo | repro")
        for k in comuns:
            v, r = por_v[k], por_r[k]
            celulas = ""
            for c in colunas:
                celulas += f"{(v.get(c) or '') + '|' + (r.get(c) or ''):>12}"
            print(f"     {k[-20:]:<26}{celulas}")
    return {"comuns": len(comuns), "divergentes": len(divergens)}


def auditar_real(dia):
    ordens, _ = carregar_csv_trilha("ordens", dia)
    deals, caminho_deals = carregar_csv_trilha("deals", dia)
    print(f"\n──────── RESULTADO REAL DA CORRETORA ({dia}) ────────")
    print(f"   tentativas de ordem no diário: {len(ordens)} "
          f"(executadas {sum(1 for o in ordens if o.get('executada') == '1')})")
    por_motivo = {}
    for o in ordens:
        cod = (o.get("motivo") or "SEM_MOTIVO").split("|")[0].strip()
        por_motivo[cod] = por_motivo.get(cod, 0) + 1
    for cod, n in sorted(por_motivo.items(), key=lambda kv: -kv[1]):
        print(f"     {cod}: {n}")
    if not deals:
        print(f"   deals: nada em {os.path.basename(caminho_deals)} — rode com --coletar-deals")
        return None
    lucro = sum(float(d["profit"] or 0) for d in deals)
    comissao = sum(float(d["comissao"] or 0) for d in deals)
    do_robo = [d for d in deals if int(float(d["magic"] or 0)) in MAGICS_ROBO]
    print(f"   negócios: {len(deals)} | lucrativo {lucro:+.2f} | comissão {comissao:+.2f} | "
          f"do robô {len(do_robo)} | manuais {len(deals) - len(do_robo)}")
    return {"deals": len(deals), "lucro": lucro, "do_robo": len(do_robo)}


def simular_saida(ativo, dia, fonte="REPRO"):
    """Modelo de saída da pirâmide sobre os sinais da fonte dada: mãe até inversão, pirâmide
    com TP de um box (PYRAMID_TP_POINTS == box_points no WIN 10R, então TP = 1 degrau)."""
    linhas = carregar_eventos(dia=dia, simbolo=ativo, fonte=fonte)
    linhas = sorted(linhas, key=lambda r: (r.get("ts_msc") or r.get("hora")))
    if not linhas:
        print(f"\n──────── SINAIS REPRODUZIDOS ({ativo} {dia}) ────────\n   sem diário {fonte} — rode reproduzir_pregao.py antes.")
        return None

    spec = ponte.get_asset_spec(ativo)
    pv = float(spec["point_value"])
    tp = float(ponte.PYRAMID_TP_POINTS)
    contratos = float(spec["contracts"])

    mae = None       # (direcao, preco_entrada)
    piramides = []   # [preco_entrada]
    travadas = []    # (tipo, dir, entrada, saida, pts, motivo)

    for r in linhas:
        preco = float(r["fechamento"])
        dir_box = "BUY" if r["direcao"] == "UP" else ("SELL" if r["direcao"] == "DOWN" else "")
        sig = (r["sinal"] or "").strip()

        if mae and dir_box == mae[0]:
            restantes = []
            for entrada in piramides:
                ganho = (preco - entrada) if mae[0] == "BUY" else (entrada - preco)
                if ganho >= tp:
                    travadas.append(("PIR", mae[0], entrada, preco, ganho, "TP"))
                else:
                    restantes.append(entrada)
            piramides = restantes

        if not sig:
            continue

        if mae is None:
            mae = (sig, preco)
        elif mae[0] == sig:
            piramides.append(preco)
        else:
            ganho_mae = (preco - mae[1]) if mae[0] == "BUY" else (mae[1] - preco)
            travadas.append(("MAE", mae[0], mae[1], preco, ganho_mae, "INVERSAO"))
            for entrada in piramides:
                g = (preco - entrada) if mae[0] == "BUY" else (entrada - preco)
                travadas.append(("PIR", mae[0], entrada, preco, g, "INVERSAO"))
            piramides = []
            mae = (sig, preco)

    ultimo = float(linhas[-1]["fechamento"])
    if mae:
        g = (ultimo - mae[1]) if mae[0] == "BUY" else (mae[1] - ultimo)
        travadas.append(("MAE", mae[0], mae[1], ultimo, g, "FECHAMENTO_PREGAO"))
        for entrada in piramides:
            gg = (ultimo - entrada) if mae[0] == "BUY" else (entrada - ultimo)
            travadas.append(("PIR", mae[0], entrada, ultimo, gg, "FECHAMENTO_PREGAO"))

    pontos = sum(t[4] for t in travadas)
    reais = sum(t[4] * pv * contratos for t in travadas)
    ganhas = sum(1 for t in travadas if t[4] > 0)
    por_motivo = {}
    for t in travadas:
        por_motivo[t[5]] = por_motivo.get(t[5], 0) + 1

    sinais = [r for r in linhas if (r["sinal"] or "").strip()]
    print(f"\n──────── SINAIS REPRODUZIDOS + MODELO DE SAÍDA ({ativo} {dia}) ────────")
    print(f"   boxes {len(linhas)} | sinais {len(sinais)} "
          f"(BUY {sum(1 for r in sinais if r['sinal'] == 'BUY')} / SELL {sum(1 for r in sinais if r['sinal'] == 'SELL')}) "
          f"| calados {len(linhas) - len(sinais)}")
    print(f"   operações fechadas: {len(travadas)} | ganhas {ganhas} ({(ganhas / len(travadas) * 100) if travadas else 0:.0f}%) "
          f"| motivos: {', '.join(f'{k}={v}' for k, v in sorted(por_motivo.items()))}")
    print(f"   pontos líquidos: {pontos:+,.0f} pts × R$ {pv}/pt × {contratos:.0f} ctro = "
          f"R$ {reais:+,.2f} no pregão (sem comissão/slippage)")
    mae_tr = [t for t in travadas if t[0] == "MAE"]
    if mae_tr:
        pior = min(mae_tr, key=lambda t: t[4])
        melhor = max(mae_tr, key=lambda t: t[4])
        print(f"   mãe: {len(mae_tr)} posições | melhor {melhor[4]:+,.0f} pts | pior {pior[4]:+,.0f} pts")
    return {"sinais": len(sinais), "operacoes": len(travadas), "pontos": pontos, "reais": reais}


def limpar_reproducao(ativo, dia):
    """Remove as linhas REPRO/MUTILADO do diário do pregão, preservando o que a ponte viu.

    Reprodução é derivável (rerodar reconstrói); o rastro VIVO não. Sem esta limpeza, rodar a
    reprodução duas vezes com âncoras diferentes deixa boxes órfãos da primeira e a fidelidade
    passa a medir o arquivo, não o motor.
    """
    caminho = os.path.join(PASTA_AUDITORIA, f"eventos_{ativo}_{dia}.csv")
    if not os.path.exists(caminho):
        print(f"   nada a limpar: {os.path.basename(caminho)} não existe")
        return 0
    with open(caminho, encoding="utf-8", newline="") as f:
        leitor = csv.DictReader(f)
        campos = leitor.fieldnames or []
        linhas = list(leitor)
    derivadas = {"REPRO", "MUTILADO"}
    sobras = [r for r in linhas if (r.get("fonte") or "") not in derivadas]
    removidas = len(linhas) - len(sobras)
    por_fonte = {}
    for r in linhas:
        if (r.get("fonte") or "") in derivadas:
            por_fonte[r["fonte"]] = por_fonte.get(r["fonte"], 0) + 1
    with open(caminho, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(sobras)
    detalhe = ", ".join(f"{k}={v}" for k, v in sorted(por_fonte.items())) or "nenhuma"
    print(f" 🧹 diário: {removidas} linhas reproduzidas removidas de {os.path.basename(caminho)} "
          f"({detalhe}) | {len(sobras)} VIVO preservadas")
    return removidas


def _percentil(vals, p):
    if not vals:
        return 0
    v = sorted(vals)
    return v[min(len(v) - 1, int(len(v) * p / 100))]


def estudo_limiares(ativo, dia, em_tela=50, grade=(0, 20, 50, 80, 100, 150, 200, 250, 300)):
    """Quanto vale cada limiar FIXO hoje, com a fita inteira, comparado com a fita mutilada.

    A pergunta que este estudo responde: os limiares que estão na tela foram calibrados olhando
    uma fita da qual faltavam ~26% dos ticks. Agora que a fita chega inteira, o MESMO número
    julga outra coisa. Comparamos as duas distribuições de |Delta| e devolvemos, para cada
    limiar de hoje, o limiar equivalente na fita cheia — o que produz a MESMA taxa de boxes
    aprovados, que é o que define o ritmo de entrada.

    O portão contado aqui é o do Delta (`|Δ| >= limiar`), que é o que o limiar fixo regula;
    consolidação/exaustão/direção ficam de fora de propósito, senão a comparação não isolaria
    o efeito da fita.
    """
    cheio = carregar_eventos(dia=dia, simbolo=ativo, fonte="REPRO")
    mutil = carregar_eventos(dia=dia, simbolo=ativo, fonte="MUTILADO")
    print(f"\n──────── ESTUDO DE LIMIARES {ativo} {dia} ────────")
    if not cheio:
        print("   sem diário REPRO — rode: reproduzir_pregao.py --dia "
              f"{dia} --ativo {ativo} --sem-filtros")
        return None
    if not mutil:
        print("   sem diário MUTILADO (a fita que o loop vivo antigo entregava) — rode:"
              f"\n     reproduzir_pregao.py --dia {dia} --ativo {ativo} --sem-filtros --feed mutilado")
        return None

    def deltas(linhas):
        return [int(float(r["delta"])) for r in linhas if (r.get("delta") or "").strip() != ""]

    d_cheio, d_mutil = deltas(cheio), deltas(mutil)
    ab = lambda ds, lim: sum(1 for x in ds if abs(x) >= lim)
    print(f"   boxes: fita CHEIA {len(d_cheio):,} | fita MUTILADA {len(d_mutil):,}")
    print(f"   |Delta| por box (pts): cheia P50={_percentil([abs(x) for x in d_cheio], 50):,} "
          f"P60={_percentil([abs(x) for x in d_cheio], 60):,} "
          f"P90={_percentil([abs(x) for x in d_cheio], 90):,} "
          f"| mutilada P50={_percentil([abs(x) for x in d_mutil], 50):,} "
          f"P60={_percentil([abs(x) for x in d_mutil], 60):,} "
          f"P90={_percentil([abs(x) for x in d_mutil], 90):,}")
    print(f"   média |Delta|: cheia {sum(abs(x) for x in d_cheio) / len(d_cheio):,.0f} pts | "
          f"mutilada {sum(abs(x) for x in d_mutil) / len(d_mutil):,.0f} pts")
    print(f"\n   {'limiar':>7} {'aprovados CHEIA':>18} {'aprovados MUTILADA':>19} {'equivalente na cheia':>23}")
    equivalencias = {}
    n_cheio_50 = ab(d_cheio, em_tela)
    for lim in grade:
        n_cheio, n_mutil = ab(d_cheio, lim), ab(d_mutil, lim)
        taxa_mutil = n_mutil / len(d_mutil)
        # o limiar da fita cheia que aprova a MESMA fração de boxes que `lim` aprova na mutilada
        alvo = taxa_mutil * len(d_cheio)
        melhor = min(range(0, max(600, max((abs(x) for x in d_cheio), default=0)) + 1, 5),
                     key=lambda c: abs(ab(d_cheio, c) - alvo))
        equivalencias[lim] = melhor
        marca = "  <<< é o que está na tela" if lim == em_tela else ""
        print(f"   {lim:>7} {n_cheio:>10,} ({n_cheio / len(d_cheio) * 100:>4.0f}%) "
              f"{n_mutil:>12,} ({n_mutil / len(d_mutil) * 100:>4.0f}%) {melhor:>15,}{marca}")
    print(f"\n   leitura:")
    p60_c = _percentil([abs(x) for x in d_cheio], 60)
    p60_m = _percentil([abs(x) for x in d_mutil], 60)
    taxa_chao = ab(d_cheio, grade[-1]) / len(d_cheio)
    print(f"     • o portão que julga de fato é o P60 do medidor de regime: ele sai de "
          f"{p60_m:,} pts (fita mutilada) para {p60_c:,} pts (fita cheia) — fator "
          f"{(p60_c / p60_m) if p60_m else 0:.1f}×. O adaptativo se recalibra sozinho; o "
          f"número fixo da tela, não.")
    print(f"     • limiar fixo {em_tela} aprova {n_cheio_50 / len(d_cheio) * 100:.0f}% dos boxes na "
          f"fita cheia e {ab(d_mutil, em_tela) / len(d_mutil) * 100:.0f}% na mutilada — e subir para "
          f"{grade[-1]} ainda aprova {taxa_chao * 100:.0f}%: a curva é quase PLANA, ou seja, o "
          f"limiar fixo não estava filtrando quase nada em nenhum dos dois mundos.")
    print(f"     • a equivalência de taxa ({em_tela} → {equivalencias.get(em_tela, 0)} pts) só serve "
          f"se você QUER um portão fixo; com a curva plana acima, o P60 é o caminho.")
    return {"cheia": len(d_cheio), "mutilada": len(d_mutil), "equivalencias": equivalencias,
            "p60_cheia": p60_c, "p60_mutilada": p60_m}


def main():
    ap = argparse.ArgumentParser(description="Audita um pregão: real × reproduzido × vivo")
    ap.add_argument("--ativo", default="WINZ26")
    ap.add_argument("--dia", required=True, help="AAAAMMDD do pregão")
    ap.add_argument("--coletar-deals", action="store_true", help="busca o extrato real no MT5 antes de auditar")
    ap.add_argument("--sem-simulacao", action="store_true")
    ap.add_argument("--detalhar", action="store_true",
                    help="imprime os boxes vivo × reproduzido lado a lado (diagnóstico de fidelidade)")
    ap.add_argument("--limpar-repro", action="store_true",
                    help="apaga as linhas REPRO/MUTILADO do diário do dia antes de reproduzir/auditar")
    ap.add_argument("--estudo-limiares", action="store_true",
                    help="compara a distribuição de Delta da fita cheia com a fita mutilada e "
                         "devolve o limiar equivalente — para revalidar os números da tela")
    ap.add_argument("--em-tela", type=int, default=50,
                    help="limiar fixo que está na tela hoje (padrão 50, o do WIN)")
    args = ap.parse_args()

    if args.limpar_repro:
        limpar_reproducao(args.ativo, args.dia)

    if args.coletar_deals:
        coletar_deals(args.dia)

    print(f"\n╔{'═' * 66}")
    print(f"║ AUDITORIA DO PREGÃO {args.dia} — {args.ativo}")
    print(f"╚{'═' * 66}")

    auditar_fidelidade(args.ativo, args.dia, detalhar=args.detalhar)
    if args.estudo_limiares:
        estudo_limiares(args.ativo, args.dia, em_tela=args.em_tela)
    auditar_real(args.dia)
    if not args.sem_simulacao:
        simular_saida(args.ativo, args.dia)


if __name__ == "__main__":
    main()
