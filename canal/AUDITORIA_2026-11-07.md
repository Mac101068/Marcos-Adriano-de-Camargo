# AUDITORIA DA PLATAFORMA — 07/11/2026

Feita pelo Mac, com prova de cada achado. Ordem: o que quebra primeiro, o que dá prejuízo depois.

---

## RESUMO EXECUTIVO

**5 achados críticos** que mexem em dinheiro ou no resultado medido, **4 de risco estrutural** e
**6 pendências de escopo**. O mais grave: **a C/V calibrada para o dólar perde dinheiro** — e a
base que usamos para dizer o contrário é uma proxy que não mede fluxo.

---

## A. CRÍTICO — dinheiro e resultado medido

### A1. A C/V no dólar dá prejuízo na base real

Rodei o motor com o preset `preset-cv-wdo` (`9477e48`) sobre `dados/mt5_real_WDOZ26` — 24.000
ticks, 13 pregões, com corretagem de R$ 2,00/contrato:

| configuração | PnL | PF | win | trades | DD |
|---|---|---|---|---|---|
| **C/V WDO · BE desligado (0/0)** | **+R$ 5.292** | **1,46** | 51,8% | 304 | R$ 2.400 |
| C/V WDO · BE 10/6 | +R$ 1.702 | 1,21 | 58,5% | 304 | R$ 1.790 |
| C/V WDO · BE 15/10 | +R$ 2.417 | 1,25 | 52,7% | 304 | R$ 2.075 |
| **C/V WDO · BE 5/3 (como eu escrevi o preset)** | **−R$ 2.918** | **0,74** | 71,5% | 304 | R$ 2.400 |
| C/V WDO · stop 10 pts (sem BE) | +R$ 4.917 | 1,47 | 44,2% | 304 | R$ 1.850 |
| C/V WIN · BE desligado (0/0) | +R$ 56.050 | 4,53 | 68,7% | 1.635 | R$ 1.110 |
| C/V WIN · BE 10/6 | −R$ 1.327 | 2,25 | 98,5% | 1.635 | R$ 210 |
| C/V WIN · stop 10 pts (sem BE) | +R$ 37.698 | 17,49 | 25,5% | 1.635 | R$ 68 |

**Conclusão:** o preset que eu criei **perde dinheiro**. Win rate alto (71,5%) com PF abaixo de 1
é a assinatura clássica de ganhar pouco muitas vezes e perder muito poucas vezes — exatamente o
que o breakeven apertado causa.

**Ação:** não usar o preset no dólar até recalibrar. O default correto é **breakeven desligado**
(o `DEFAULT_EA_CONFIG` já está 0/0 desde `5d13cf4`; o **preset WDO** é que ficou com 5/3).

### A2. O preset WDO contradiz o default e o próprio commit

`src/services/eaConfigService.ts:182` — `preset-cv-wdo` traz `breakevenTriggerPoints: 5` e
`breakevenLockPoints: 3`. O `5d13cf4` desligou o breakeven por padrão porque custava 81% no WIN.
O preset que eu escrevi **religa** o breakeven no dólar, e no dólar ele custa **183%** do
resultado (−2.918 contra +5.292).

**Ação: FEITO** — preset corrigido para `0/0` neste mesmo commit. O WDO agora sai com
**+R$ 5.292 (PF 1,46)** em vez de −R$ 2.918.

### A3. O número de R$ 52.100 do WIN não é lucro esperado

O `labReal.ts` roda sobre `mt5_real_WINZ26` com `volumeSource: M1_RATE` — a própria base declara:
*"o volume dos ticks não é volume de negociação — a ponte improvisou pela série de 1min"*.

O funil SEL-A filtra por **delta de agressão**. Se o volume é proxy de M1, o delta é proxy de
proxy. Os números medem **direção**, não valor absoluto — foi o que o `PROJECT_SUMMARY` já
registrava no Ciclo 16 (`eaBaseReal`). O risco é o operador tratar R$ 52.100 como expectativa.

**Ação:** nenhum código. É decisão de expectativa: **nada está validado em dinheiro real**.

### A4. O dólar tem um defeito de dado que favorece artificialmente

Aviso da própria base: *"O feed demo entrega só pontos inteiros no WDO, mas o tick do WDO é 0,5:
meia-variação não aparece."* Com tick efetivo de 1,0 pt e box de 2,5, o Renko vê só 2,5 degraus
por tijolo — o comportamento ao vivo será diferente do medido.

**Ação:** qualquer calibração do dólar feita nesta base é provisória. Precisa de fita com T&T.

### A5. Os campos do breakeven não existem na tela

`breakevenTriggerPoints` e `breakevenLockPoints` estão no tipo, no service e no motor — e
**não aparecem em nenhum componente**:

```
grep -rn "breakevenTriggerPoints\|breakevenLockPoints" src/ --include=*.tsx
(sem saída)
```

O operador decidiu "campos na boleta, nada fixo no mercado". Hoje o campo é invisível: só existe
como default e como JSON. **A padronização que combinamos não está entregue na interface.**

**Ação:** é `BoletaTicket.tsx` — meu arquivo, trava escrita. Pendente.

---

### A6. O WIN medido antes não cortava o degrau de feed

O `labReal.ts` (Windows) corta o degrau de 31.025 pts entre 30/10 e 03/11. O meu `labAsset.ts`
não cortava — e com o degrau dentro, o WIN dava +R$ 57.150 com 1.640 trades; cortado, dá
+R$ 56.050 com 1.635. **Diferença pequena**, mas o corte é obrigatório: sem ele o Renko gera
cauda de tijolos falsos. Já implementado em `scripts/labAsset.ts`.

### A7. O resultado do WIN é dominado por poucos dias

R$ 56.050 em 1.635 trades com DD de R$ 1.110 é um perfil suspeito de "um dia enorme e o resto
empate". A distribuição por pregão precisa ser olhada antes de tratar isso como expectativa —
o `labReal` já mostra isso no relatório de dias positivos, o meu lab ainda não.

**Ação:** acrescentar por-dia ao `labAsset.ts` antes de qualquer decisão de capital.

## B. RISCO ESTRUTURAL — a classe de bug que custou o dia

### B1. Existem DUAS fontes de gestão por ativo

`src/App.tsx:5234` (`patchActiveStrategy`) grava um subconjunto de campos em
`fluxo_asset_trade_params_<ATIVO>`:

```
boxPoints, stopLossPoints, takeProfitPoints, partialPoints,
breakevenOffsetPoints, trailingDistancePoints, minDeltaThreshold, contracts
```

E `getAssetTradeParams` (App.tsx:65) lê dessa chave **antes** do registro. Resultado: o mesmo
campo vive em `fluxo_renko_ea_config_v3` (config/estratégia), em `..._trade_params_<ATIVO>` e no
`assetRegistry`. Foi exatamente essa tripla que produziu o bug de hoje.

**Ação:** decidir e eliminar uma. A decisão do operador (boleta é a fonte única) aponta para
aposentar `fluxo_asset_trade_params_*`. É `App.tsx` — do Windows.

### B2. Onze migrações independentes, cada uma com flag própria

`src/utils/*Migration*.ts` + `src/assets/*Migration*.ts` — 11 arquivos, cada um reescrevendo
`fluxo_renko_ea_config_v3` direto, cada um com `DONE_FLAG`. Hoje funciona. Amanhã, duas migrações
novas na ordem errada se sobrescrevem.

**Ação:** consolidar num registro com ordem explícita. Não é urgente; é dívida.

### B3. `App.tsx` com 10.151 linhas

Um arquivo com 25% de todo o código do projeto (40.201 linhas em 71 arquivos). Todos os bugs de
hoje nasceram nele. Toda colisão entre as duas instâncias acontece nele.

**Ação:** não refatorar agora (risco alto, ganho lento). Registrar: é a fonte do retrabalho.

### B4. Nenhum teste automatizado de comportamento

Existem asserts de configuração (`bridgeScriptAssert`, `chartContractAssert`,
`renkoBoxScaleAssert`, `robotMagicAssert`) e dois labs (`labReal`, `eaBaseReal`). **Não existe
teste que rode as três estratégias sobre a fita e compare com um baseline.** Foi por isso que o
`5d13cf4` só descobriu o custo do breakeven porque alguém rodou à mão.

**Ação:** o `scripts/_labwdo.ts` que eu escrevi na auditoria é o embrião disso. Vale virar
`scripts/labAsset.ts` parametrizado por ativo, rodando no CI.

---

## C. PENDÊNCIAS DE ESCOPO

| # | pendência | dono | estado |
|---|---|---|---|
| C1 | Campos do breakeven na boleta (A5) | Mac | pendente |
| C2 | Padronizar as 3 estratégias lendo só a boleta | Mac + Windows | motor pronto (`1156eee`), Pirâmide ainda lê `pyramidTpPoints` |
| C3 | Remover `pyramidTpPoints`/`pyramidSlPoints` (2ª etapa) | Windows | agendado, não feito |
| C4 | Validar ao vivo na demo XP | operador | **nunca feito** — é o marco real |
| C5 | Módulo SaaS/paywall em `localStorage`, sem backend | ninguém | declarado no próprio doc |
| C6 | Firewall da 8765 | — | **dispensado**: a porta passa, testado |

---

## D. O QUE ESTÁ SÓLIDO (para não mexer)

- **Ponte**: `AUTH OK` com chave fixa, conta XP carregada, `ALLOW_NO_TOKEN=false`. Testado hoje.
- **Tipos**: `tsc --noEmit` limpo em 67 campos de `AutomationConfig`, nenhum campo sem `??` no
  `loadSavedConfig`.
- **Isolamento por ativo**: livro de auditoria e `R$/ponto` separados por `assetId`, provado em
  `setAsset()`.
- **Registro de ativos**: WDO homologado (`status: 'ativo'`), box 2,5 e R$ 10/pt corretos.

---

## E. PLANO SUGERIDO, EM ORDEM

1. **Corrigir o preset WDO para 0/0** (Mac, 5 min) — hoje ele entrega prejuízo.
2. **Campos do breakeven na boleta** (Mac) — sem isso a padronização não existe na tela.
3. **Eliminar `fluxo_asset_trade_params_*`** (Windows) — mata a classe de bug de hoje.
4. **Virar o lab em ferramenta por ativo** (Mac) — impede regressão silenciosa.
5. **Validar ao vivo na demo** (operador) — o único passo que transforma proxy em fato.

---

*Auditoria do Mac, 07/11/2026. Cada número aqui foi medido; nenhum é estimativa.*
