# 📊 Memória & Documentação do Projeto: Fluxo & Renko 10R MT5 Quant Terminal

> **Documento de Continuidade e Memória Operacional**: Este arquivo reúne o estado atual consolidado — regras de negócio, lógica quantitativa e arquitetura técnica — para restauração imediata de contexto em novos bate-papos.
>
> 🧬 O histórico detalhado de **todas as evoluções**, com causa raiz e verificação de cada ciclo, vive em `EVOLUCOES_DETALHADAS.md`. O prompt de retomar em conversa nova está em `PROJECT_CONSOLIDATION_CHAT_SEED.md`.

---

## 🎯 1. Visão Geral do Sistema

O **Fluxo & Renko 10R - MT5 Quant Terminal** é uma plataforma quantitativa profissional de alta performance para operações no Mini-Índice B3 (`WIN$`). O terminal opera combinando análise de fluxo atemporal com gráfico atemporal de tijolos Renko, enviando ordens automatizadas via ponte WebSocket para o MetaTrader 5.

### Pilares Centrais:
1. **Gráfico Renko 10R (50 pontos)**: Construção atemporal com tijolos finos, corpo 100% preenchido e aproximação temporal progressiva.
2. **Fluxo & Tape Reading Tick-a-Tick**: Agressão compradora vs. vendedora, saldo Delta e CVD (*Cumulative Volume Delta*), com **Limiar Adaptativo de Regime** (o Delta Mínimo acompanha a assimetria intradiária: abertura forte, almoço fraco).
3. **Duas estratégias selecionáveis**: **Reteste (Pullback)** clássico, com parcial/breakeven/trailing, e **Pirâmide & Confluência de Fluxo**, com mãe de surfe + pirâmides de TP 50 pts.
4. **Gatilho de Entrada configurável**: a mercado no fechamento do box, Limit a 50% do box ou Limit na abertura (reteste), com validade em boxes.
5. **Gerenciamento de Risco Institucional**: Stop Loss, Take Profit, Realização Parcial (com Stop no Breakeven), **Proteção da Ordem Mãe em dois estágios (gatilho → piso → acompanhamento)** e trava de fim de pregão às 17:30.
6. **Curva de Patrimônio Acumulado (Equity Curve)**: Rastreamento trade-a-trade, High-Water Mark, Underwater Drawdown e métricas de risco.
7. **Coletor Multi-Série & Robôs Sombra**: seis motores (Renko 10R, Renko 15R, Range, Tempo…) rodando a mesma régua de regras em paralelo, com aba **Comparativo** para escolher qual escala merece ordem real e aba **Avaliação Técnica** que decompõe o resultado por motivo de saída, papel, direção, horário e regime.
8. **Simulador & Replay**: feed autônomo B3, reprodução progressiva de dias úteis e modo **OPERA**, que roda a estratégia de verdade pelo mesmo `handleIncomingTick` do terminal.
9. **Responsividade Mobile Completa**: gestos touch (Pan, Pinch-to-Zoom, arrasto dos divisores com o dedo), Bottom Navigation com "Mais" e HUD adaptativo.
10. **Integração MetaTrader 5 (Python Bridge) blindada**: WebSocket com handshake de token, armamento `ARM`/`DISARM` e tetos de risco impostos pela própria ponte.
11. **Auditoria Intraday & Compliance**: trilha de eventos por ordem, filtros, timeline e exportação CSV padrão brasileiro.
12. **Módulo SaaS & Painel Master do Administrador**: licenciamento por dias, paywall com checkout PIX/Cartão e gestão de clientes (⚠️ ainda maquete em `localStorage`, sem backend).

---

## ⚙️ 2. Regras da Estratégia Quantitativa

### A. Renko 10R (50 pontos no Mini-Índice)
- **Tamanho do Box**: 50 pontos por box (10R na convenção clássica brasileira de 5 ticks/ponto).
- **Fechamento de Alta**: Fechamento = Abertura + 50 pts.
- **Fechamento de Baixa**: Fechamento = Abertura - 50 pts.
- **Reversão**: Exige 2 boxes (100 pontos) no sentido oposto para inverter a direção.
- **Estilo Visual dos Blocos**:
  - Blocos finos (10px padrão fino / 7px ultra-fino / 14px médio).
  - Corpo 100% sólido opaco (Verde `#10b981` e Vermelho `#ef4444`), sem corpo vazado.
  - Pavios (Wicks) centralizados com máxima e mínima.
- **Aproximação Temporal Progressiva na Formação**:
  - No início da formação e nos blocos mais recentes à direita, o espaçamento começa mais arejado e aberto.
  - Conforme novos ticks e boxes entram no fluxo e envelhecem na série histórica, os blocos vão se aproximando progressivamente de forma suave e compacta.
  - Margem de respiração à direita (Offset configurável) e suporte a Pan/Arrasto com mouse ou toque.
- **Escalas Ajustáveis dos Eixos X e Y (Visibilidade Sob Medida)**:
  - **Eixo Y (Escala Vertical de Preços)**:
    - Arrasto interativo na régua de preços (cursor `ns-resize`): arrastar para cima estica os tijolos (maior resolução vertical), arrastar para baixo comprime (mais pontos na tela).
    - Deslocamento vertical (Pan em pontos): segurando Shift ou pelos botões flutuantes `▲`/`▼`.
    - Controles de zoom `Y-` / `Y+` com indicador percentual na barra e mini-widget flutuante `+Y`, `🎯`, `-Y` sobre o eixo Y.
    - Grade dinâmica adaptativa (alterna automaticamente entre 25, 50 e 100 pts) e leitura direta do preço sob a mira com badge no eixo.
    - Duplo clique na régua de preços restaura a Auto-Escala Y instantaneamente.
  - **Eixo X (Escala Horizontal de Tempo & Espaçamento dos Boxes)**:
    - Controles de zoom `X-` / `X+` com indicador percentual na barra.
    - Arrasto interativo na régua de tempo inferior (`ew-resize`) para comprimir ou expandir o horizonte temporal.
    - Rótulos de tempo nos blocos com formatação HH:MM:SS na base do gráfico.
    - Zoom inteligente pela roda do mouse (Roda sobre o gráfico altera X; Roda sobre o eixo Y altera Y).
    - **Modo estudo multidia**: o modo Preencher honra o "Tijolos X" diretamente (até **3000** boxes ≈ 15 dias na tela), com piso de zoom X de 0,15 e auto‑ajuste de passo até 1px — vários dias cabem juntos para estudo, com a linha âmbar `ABERTURA` separando cada pregão.
    - **Engrenagem ⚙ sobreposta à régua de preços** (canto inferior direito, centralizada na escala): abre painel retrátil com tijolos, zoom, FILL/STD, HOJE, escala do fluxo e legenda — a antiga tira de rodapé e a legenda full foram removidas.
    - Régua de preços estreita (64px desktop / 46px mobile) com rótulos centralizados.
    - Gestos de pinça touch (Pinch vertical no celular ajusta escala Y, Pinch horizontal ajusta escala X).
    - Persistência automática das preferências de escala (`scaleX` e `scaleY`) em `localStorage`.
- **Seletor de Série do Gráfico (Só duas opções visíveis)**:
  - **`Pontos` (Renko)** e **`Range`** (variação de preço por barra, escala configurável 10–150 pts).
  - A série de **Tempo saiu do gráfico**: continua existindo nos motores e no Coletor como histórico/comparação, mas não é mais opção de desenho.
- **Quadro Informativo Box Renko**:
  - Desktop: Fixo permanentemente no canto inferior direito (`bottom-3 right-[88px]`), exibindo OHLC, CVD, Delta e convergência.
  - Mobile: Pílula compacta recolhível (`Detalhes ▾`) no rodapé para não cobrir o gráfico.
  - **Janela Flutuante “Box Renko”** (variante `window` do `RenkoBoxCard` dentro de `DadosPanelWindow`): arrastável, com selo `AO VIVO` / `INSPEÇÃO` e duplo clique devolvendo ao canto de origem.

### B. Saldo de Agressão & CVD (Times & Trades)
- Cada negócio recebido é classificado pelo agressor:
  - **BUY**: Comprador agrediu o book de venda (Delta positivo).
  - **SELL**: Vendedor agrediu o book de compra (Delta negativo).
- **CVD (Cumulative Volume Delta)**: Soma cumulativa do Delta ao longo da sessão.
- **Filtro de Validação**: apenas boxes com Delta líquido acima de `minDeltaThreshold` (ex: 250 contratos) qualificam sinal — e com o **Limiar Adaptativo de Regime** ligado esse limiar deixa de ser fixo e vira `±minDeltaThreshold × fator do momento` (ver seção G).
- **Painel Inferior de Fluxo, Modo Heikin-Ashi & Escala Ajustável**:
  - Seletor de 3 modos na barra de ferramentas: **`[ Heikin-Ashi | Delta | Híbrido ]`** (preferência persistida em `localStorage`).
  - **Ajuste Dinâmico da Altura da Janela (Divisor Interativo)**:
    - Linha divisora com puxador visual centralizado (`handle` com 3 pontos e cursor `row-resize`).
    - Arrastar o divisor redimensiona a altura da janela de fluxo continuamente entre **18% e 55%** da tela.
    - Presets de 1 clique na barra superior: **`Janela: [ 25% | 33% | 46% ]`**.
    - Duplo clique no divisor restaura a proporção equilibrada padrão de 33%.
    - **Destaque em verde** enquanto o cursor está sobre a linha ou durante o arraste (feedback de que é interativa), com alça de 48 px no desktop e 34 px no mobile.
  - **Divisor Interno Heikin-Ashi ↔ Histograma (também arrastável)**:
    - No modo Heikin-Ashi, o painel de fluxo é dividido em duas subfaixas; a linha entre elas usa **exatamente o mesmo acabamento** do divisor de cima (linha + alça + 3 pontos + destaque verde).
    - `haHistSplit` controla a fatia do fluxo destinada às velas: **30% a 85%**, padrão **66%**; arrastar para baixo aumenta o Heikin-Ashi, para cima aumenta o histograma.
    - Persistido em `localStorage`, restaurável por duplo clique na linha (volta a 66%) ou pelo reset geral de escalas.
    - **Arraste com o dedo no celular** para os dois divisores (tolerância de 12 px, para não brigar com a rolagem do gráfico).
    - O hit-test de desenho, cursor, mouse e toque usa um único helper (`getFlowDividerLayout`), então a área clicável nunca descola da linha visível.
  - **Etiquetas das Faixas** (somente em desktop, em cinza discreto no canto esquerdo): `PREÇO · RENKO` / `PREÇO · RANGE` / `PREÇO · TEMPO`, `FLUXO · HEIKIN-ASHI` / `FLUXO · DELTA` / `FLUXO · HÍBRIDO` e `HISTOGRAMA · DELTA`.
  - **Escalas Numéricas Adaptativas nas Duas Subfaixas**:
    - **Heikin-Ashi**: passo “limpo” adaptativo (1, 2, 2.5, 5, 10 × 10ⁿ) conforme a altura visível — antes travava no mínimo 50 pts e gerava poucas linhas em janelas pequenas.
    - **Histograma de Delta**: régua própria com rótulos `+50Δ` / `-100Δ` / `1.2kΔ`, linha de zero destacada e guias de limiar em `±minDeltaThreshold`.
    - Grades e badges de cada subfaixa são **presos ao seu próprio intervalo vertical** (`haBandTop`/`haBandBottom` e `histBandTop`/`histBandBottom`) — nenhuma linha invade a banda vizinha.
  - **Escala Vertical Independente do Fluxo (`scaleFlow` & `flowPanOffset`)**:
    - **Arrasto Interativo no Eixo Lateral do Fluxo**: clicar e arrastar a régua lateral abaixo do divisor estica (`+F`) ou comprime (`-F`) a amplitude das velas/barras de fluxo (cursor `ns-resize`).
    - **Deslocamento Vertical (Pan)**: segurando `Shift` ao arrastar desloca o ponto zero/médio do fluxo.
    - **Controles na Barra Superior**: widget dedicado **`Fluxo: [ - | 100% | + ]`** com indicação de zoom percentual e clique para reset.
    - **Mini-Widget Flutuante**: botões `+F`, `🎯` (auto-escala do fluxo) e `-F` fixados na lateral direita da janela de fluxo.
    - **Roda do Mouse (Wheel)**: girar sobre a régua lateral do fluxo (ou segurando `Alt` no painel) amplia ou reduz a escala instantaneamente.
    - **Duplo Clique**: restaura a auto-escala do fluxo para 100% e offset 0.
  - **Auto-Ajuste à Janela Visível (Visible-Range Fitting)**:
    - O cálculo de mínimos e máximos Heikin-Ashi é computado com base apenas nos boxes visíveis na tela, evitando que distorções históricas fora da visão comprimam os candles atuais.
  - **Calibração e Grade Numérica no Eixo Lateral**:
    - Régua lateral do fluxo calibrada com ticks numéricos (`+1.5k`, `+1.0k`, `+500`, `0`, `-500`, `-1.0k` ou `Δ`) e linhas guia horizontais tracejadas.
    - Badge destacado com cor de status em tempo real mostrando o valor exato do último candle/delta na régua.
    - Leitura direta sob a mira do crosshair para inspeção milimétrica de saldo agressor.
  - **Cálculo Heikin-Ashi Suavizado do Fluxo**:
    - Derivado a partir do CVD e excursões intra-box de agressão:
      - $haClose = (Open + High + Low + Close) / 4$
      - $haOpen = (prevHaOpen + prevHaClose) / 2$
      - $haHigh = \max(High, haOpen, haClose)$
      - $haLow = \min(Low, haOpen, haClose)$
    - **Coloração Padronizada e Intuitiva**:
      - 🟢 **Verde (`#10b981`)**: Subida contínua de fluxo agressor (pressão compradora acelerando).
      - 🔴 **Vermelho (`#ef4444`)**: Descida contínua de fluxo agressor (pressão vendedora acelerando).
      - ⚪ **Cinza (`#94a3b8`)**: Reversão de fluxo / Indecisão / Absorção (quando há inversão de direção em relação à barra anterior ou doji de absorção de agressões).
  - Pavios (Wicks) superior e inferior destacando amplitude do fluxo e presença de rejeição.
  - Persistência total de todas as escalas (`scaleX`, `scaleY`, `scaleFlow`, `flowPaneRatio`, `haHistSplit`, `flowPanOffset`) no `localStorage` (chave `fluxo_renko_chart_scales_v2`).


### C. Gatilho de Entrada (Três Modos, Válidos para a Mãe e para as Pirâmides)
- **`MARKET_ON_CLOSE`** (padrão): executa a mercado no preço de fechamento do bloco que confirmou o sinal.
- **`BOX_50_LIMIT`**: ordem **limitada a 50% do box** que fechou — só executa se o preço recuar metade do caminho (renko, range ou pontos).
- **`BOX_OPEN_LIMIT`**: ordem limitada na **abertura do box** (recuo de 100%) — entrada mais barata, com risco real de não ser executada.
- **Validade da limitada** (`pullbackMaxBoxesWait`, 1 a 10 boxes): se o preço não recuar até o nível dentro da validade, a ordem é **cancelada** (motivo `EXPIRED_PULLBACK`).
- No MT5: ordem `BUY_LIMIT` / `SELL_LIMIT`; no terminal a ordem nasce com `status: 'PENDING_LIMIT'`, `limitPrice` e `pendingBoxIndex`, e o monitor de ticks executa ao tocar o nível (compra: recuou até ele; venda: subiu até ele).
- **TP/SL das pirâmides são ancorados no preço real de entrada** (o nível do Limit), não no fechamento do box.
- Gráfico: Linha tracejada âmbar com alvo de reteste e status `AGUARDANDO RETESTE`.

### D. Gestão de Risco
#### D.1 Estratégia Reteste (Parcial + Breakeven + Trailing)
- **Stop Loss Base**: 100 pontos (2 boxes 10R) · **Take Profit Base**: 150 pontos (3 boxes 10R).
- **Realização Parcial & Breakeven Automático**: ao atingir `partialPoints` (+50 pts = 1 box a favor), realiza `partialContracts` (1 contrato) e move o stop do saldo para **Entrada + `breakevenOffsetPoints`** (5 pts de offset de taxas).
- **Trailing Stop Dinâmico**: ativa a partir de `trailingActivationPoints` (+60 pts) e mantém o stop a `trailingDistancePoints` (50 pts) atrás do extremo alcançado.

#### D.2 Proteção da Ordem Mãe na Pirâmide (Gatilho → Piso → Acompanhamento)
A mãe nasce **sem TP e sem SL fixos** (`stopLoss: 0`, `takeProfit: 0`). Quando a proteção é ligada, ela passa por **três estágios**, na semântica exata de “100 de gatilho → vai para 30 pontos → depois segue o preço a 50”:
1. **Gatilho** (`trailingActivationPoints`): enquanto a mãe não corre X pontos a favor, **não existe stop** — ela surfa livre.
2. **Piso** (`breakevenOffsetPoints`): no gatilho, o stop nasce na `entrada + piso` (compra) / `entrada − piso` (venda), cobrindo emolumentos da B3.
3. **Acompanhamento** (`trailingDistancePoints`): daí em diante o stop segue a máxima (compra) ou a mínima (venda) da perna sempre a essa distância, escolhendo a posição que **mais protege** (`Math.max` na compra / `Math.min` na venda). **O stop só anda a favor.**
- O cálculo aceita `stopAtual <= 0` como “ainda sem stop”, então o trailing consegue **criar o primeiro stop nos dois lados** (era exatamente o defeito que impedia o acompanhamento de funcionar na venda).
- Na Pirâmide o acompanhamento se aplica **somente à ordem mãe** (`role === 'MAIN'`) — as pirâmides morrem no próprio TP.
- Estágio separado e opcional, `moveMainToBreakevenOnPyramidTp`: a cada **TP de pirâmide batido**, a mãe vai ao breakeven usando o mesmo piso de taxas.
- Os dois caminhos (`App.tsx` no pregão ao vivo e `paperStrategyBot.ts` nos robôs sombra) usam a **mesma regra**, para o coletor não medir uma estratégia diferente da que aparece na tela.
- Interface: grupo **“🛡️ Proteção da Ordem Mãe”** em Ajustes → Pirâmide → Regras de Saída, com os três campos (Gatilho 25–500 passo 25 · Distância 25–300 passo 25 · Piso 0–50 passo 5) e um **resumo dinâmico em texto**: “A mãe corre +N pts → o stop vai para a entrada +Y pts → depois acompanha o preço sempre a Z pts do extremo.”

#### D.3 Trava de Fim de Pregão (17:30)
- `src/utils/sessionRules.ts` define a janela **17:30 → 18:05** (o WIN$ encerra às 17:45; a janela maior só cobre a liquidação).
- Dentro da janela: tudo o que estiver aberto é **liquidado a mercado** (`DAY_CLOSE` / `DAY_CLOSE_FORCED`) e nenhuma operação nova é aberta até o pregão seguinte.
- Fora da janela (madrugada/noite, quando o simulador continua gerando ticks) o robô opera normalmente — senão ficaria parado o dia inteiro.
- Compartilhado entre terminal e robôs sombra; o aviso do terminal é **um só por tick**, não um por ordem liquidada.

#### D.4 Filtros de Horário e Limites
- Janela day trade configurável (`tradingStartTime`, `tradingStopEntriesTime`, `tradingCloseAllTime`) e travas financeiras (`maxDailyLoss`, `maxDailyProfit`, `maxDailyTrades` — 0 = sem limite, para permitir piramidação contínua).

### E. Suporte a Contas Hedge
- Permite manter posições compradas e vendidas simultaneamente.
- Envio de ordens no Python com `position = ticket` em `TRADE_ACTION_DEAL` para fechamento individual de posições.

### G. Limiar Adaptativo de Regime (assimetria intradiária)
- **Problema**: o volume por box na abertura roda várias vezes acima do almoço (curva em U) e a agressão compradora × vendedora tem distribuições diferentes — um limiar FIXO para o dia inteiro ou é frouxo de manhã ou trava à tarde.
- **Medidor (`src/utils/sessionRegime.ts`)**: `fator = volume médio dos últimos N boxes ÷ média do dia até agora` (clamp 0,5×–3,0×) + dois fatores direcionais (magnitude de delta positivo/negativo). A janela `regimeLookbackBoxes` é configurável (10–50, padrão 20). Reset automático na virada de dia.
- **Gate**: com `adaptiveThresholdEnabled` (padrão ligado), o `convergenceEvaluator` exige `|Δ| ≥ minDeltaThreshold × fator` do lado correspondente — vale para as DUAS estratégias (Pirâmide e Clássica) e para as três séries do coletor. O box guarda o fator vigente (`regimeFactor`) e o motivo do sinal traz `vs ≥N | fator X.XXx`.
- **Medição sempre ativa**: o medidor é alimentado mesmo com o gate desligado (é a fonte da seção "Regime do Mercado" da Avaliação Técnica e da coluna FATOR REGIME do CSV).
- **Ponte MT5**: o script gerado embute um `RegimeMeter` equivalente em Python (mesma fórmula e clamp) — paridade terminal × sombra × script.
- **Simulador equilibrado**: o gerador de dias sorteia ~40% alta / ~40% baixa / ~20% lateral (sem viés comprador embutido), para o adaptativo poder ser testado em dias baixistas.

---

## 📈 3. Curva de Patrimônio Acumulado (Equity Curve)

Módulo analítico completo com aba dedicada na barra superior e no menu mobile (**"Curva"**):
- **Gráfico Principal de Patrimônio**:
  - Traçado trade-a-trade com preenchimento em gradiente.
  - **High-Water Mark**: Linha pontilhada azul ciano mostrando o pico histórico de capital.
  - **Mark-to-Market (MTM ao vivo)**: Integração tick-a-tick do PnL flutuante de operações abertas.
  - **Seletor de Métrica**: Patrimônio Total (R$), Lucro Líquido Acumulado (R$) ou Curva em Pontos (pts).
  - **Capital Inicial Customizável**: Presets de R$ 2.000, R$ 5.000 (padrão 2 ctros), R$ 10.000 e R$ 25.000.
- **Gráfico Subaquático de Drawdown (Underwater Chart)**:
  - Curva de área invertida em `%` e `R$` destacando a profundidade e duração de rebaixamentos de capital.
- **Histograma de Distribuição por Trade**:
  - Barras verticais verdes (ganhos) e vermelhas (perdas) de cada operação realizada.
- **Matriz de Risco & KPIs Quantitativos**:
  - Patrimônio Atual, Lucro Líquido Total, Win Rate (%), Fator de Lucro, Payoff Ratio, Drawdown Máximo, Fator de Recuperação, Expectativa Matemática por Trade, Maior Ganho/Perda e Sequência Máxima de Ganhos/Perdas.
- **Exportação CSV**: Download da série histórica completa em 1 clique para análise externa no Excel ou Python.

### F. Livro de Auditoria de Ordens Intraday B3 & Compliance
- **Finalidade**: Atender a exigências regulatórias, de compliance operacional e rastreabilidade intraday do trader/operador de mesa.
- **Rastreabilidade Completa**:
  - **Ticket MT5 / Identificador**: Ticket numérico único por ordem (#849102, #849156...).
  - **Timestamps Detalhados**: Horário de disparo, horário de execução (preenchimento no reteste), horário de parcial e horário de encerramento.
  - **Lado & Volume**: COMPRA (`BUY`) ou VENDA (`SELL`), lote original de contratos e lote restante após realização parcial.
  - **Preços & Níveis**: Preço de envio/limite, preço executado, Stop Loss inicial, Stop Loss no Breakeven, Trailing Stop, Take Profit e preço final de saída.
  - **Execução Parcial & Proteção**: Registro de contratos executados na parcial, pontos colhidos, financeiro realizado em R$ e ativação do Breakeven com offset de taxas da B3.
  - **Motivo da Saída**: `TAKE_PROFIT`, `STOP_LOSS`, `BREAKEVEN`, `TRAILING_STOP`, `MANUAL` ou `EXPIRED_PULLBACK`.
  - **Gatilho de Fluxo & Convergência**: Registro exato das métricas que dispararam a ordem (Delta do box, CVD, reteste, rompimento).
  - **Origem da Ordem**: `ROBOT_EA` (Robô 10R Automático), `MANUAL` (Boleta rápida terminal) ou `MT5_LIVE` (MetaTrader 5 Real).
- **Métricas Consolidadas de Auditoria**:
  - Total de Ordens Disparadas, Ordens Executadas e Taxa de Preenchimento (Fill Rate %).
  - Lucro Líquido Auditado (R$) e Pontuação Líquida (pts).
  - Taxa de Acerto (Win Rate %) com divisão `W` (Wins) / `L` (Losses) / `BE` (Breakeven).
  - Fator de Lucro (*Profit Factor*) auditado da sessão.
  - Total de Saídas Parciais Concluídas e Lucro Parcial Colhido (R$).
  - Ordens canceladas/expiradas no pullback por falta de reteste.
- **Filtros e Ferramentas de Auditoria**:
  - Campo de busca instantânea por Ticket (#), horário, gatilho ou status.
  - Filtro por Status: `Todas`, `Abertas`, `Fechadas no Lucro (TP)`, `Fechadas no Prejuízo (SL)`, `Aguardando Reteste`, `Expiradas/Canceladas`, `Encerradas Manuais`.
  - Filtro por Lado: `Todas`, `Compras (BUY)`, `Vendas (SELL)`.
  - Filtro por Origem: `Todas`, `Robô EA Automático`, `Terminal Manual`, `MT5 Real B3`.
- **Exportação & Diário de Bordo**:
  - **Exportar CSV (Excel)**: Gera arquivo `.csv` padronizado para o Brasil (separador `;`, BOM UTF-8, formatação numérica de pontos e moeda R$ compatível com Excel e Google Sheets).
  - **Copiar Relatório de Auditoria**: Diário de bordo formatado com resumo executivo e linhas de ordens para área de transferência (WhatsApp, Slack, Telegram, diário de trading).
  - **Reiniciar Pregão**: Botão com confirmação para limpar e reiniciar o livro de auditoria para um novo dia de operações.
- **Trilha de Auditoria Interativa (Timeline Modal)**:
  - Clicar em qualquer ordem abre uma linha do tempo vertical detalhada com todos os eventos cronológicos daquela ordem (Detecção de Sinal ➔ Disparo ➔ Preenchimento no Reteste ➔ Saída Parcial ➔ Breakeven ➔ Trailing Stop ➔ Liquidação Final) e selo de validação.
- **Persistência**: Registros salvos em `localStorage` sob a chave `fluxo_renko_intraday_audit_v1`.

---

## 🧪 3B. Coletor Multi-Série, Robôs Sombra & Simulador/Replay

- **Coletor (`src/services/seriesCollectorService.ts`)**: alimenta **seis motores em paralelo** (Renko 10R, Renko 15R, Range, Tempo e variações) com os **mesmos ticks** que abastecem o gráfico, para comparar escalas na mesma janela de mercado.
- **Robôs sombra (`src/utils/paperStrategyBot.ts`)**: contabilidade independente por série com marcação a mercado das posições abertas, curva de patrimônio, expectativa, fator de lucro, maior ganho/perda e drawdown em R$.
- **Continuidade contábil**: os **acumulados contínuos** (`PaperCounters`) são persistidos separadamente da lista de trades (limitada a 1200 por série), para que um F5 nunca encolha win rate, fator de lucro ou expectativa.
- **Dado real × replay sintético**: o coletor marca o dia com `real` no primeiro tick vindo do MT5 (`markRealData()` / `hasRealData()`). Essa marca é o **portão** que impede o replay automático de abertura de apagar um pregão verdadeiro já coletado.
- **Aba Comparativo**: mesmas métricas lado a lado por série, para decidir qual escala merece ordem real.
- **Aba Avaliação Técnica (`TechnicalEvaluationView.tsx`)**: 100% leitura do MESMO snapshot do coletor — win rate, fator de lucro e expectativa decompostos por **motivo de saída** (quanto é liquidação forçada de fim de pregão?), **papel** (MAIN × Pirâmide), **direção** e **faixa de horário de entrada**, mais a seção **Regime do Mercado** (estatísticas por hora lidas direto dos medidores vivos via `registerRegimeMeter`/`getRegimeReading`). Nada aqui dispara ordem.
- **CSV do coletor** com coluna **FATOR REGIME** por trade (`PaperTrade.regimeFactor`), para provar no Excel a qualidade das entradas por momento de pregão.
- **Simulador**: visão do feed (preço, ritmo, buffer, robô), cartões dos motores e replay.
  - **Dias equilibrados**: o gerador sorteia ~40% alta / ~40% baixa / ~20% lateral (sem viés comprador embutido), com o viés valendo a sessão inteira e perdendo força no almoço.
  - **Ritmo**: o 1x foi desacelerado para ficar assistível — agora é **compasso por tick** (1x ≈ 2,0 s/tick; um dia leva ~1min45 no replay; 10x ≈ 5 s), e o mesmo controle vive na tira de status abaixo do menu.
  - **Replay progressivo**: começa na primeira barra e desenha o período todo (mínimo 1 dia), dispara sozinho na abertura da plataforma.
  - **Dia anterior ESTÁTICO**: sempre +1 dia de contexto na tela (a abertura do dia‑alvo tem o fechamento de ontem como referência), processado de uma vez, sem animação, **sem nunca operar** e **sem nenhuma marca ▲/▼** (`isStaticContext` suprime as setas no gráfico) — a linha âmbar `ABERTURA` separa os dias.
  - **Modo OPERA**: o replay roda a estratégia **de verdade** pelo mesmo `handleIncomingTick` do terminal — abre mãe e pirâmides, enche a auditoria e move o PnL (precisa do Robô LIGADO).
  - **Zera a sessão**: o replay limpa ordens abertas, livro de auditoria e PnL (pregão limpo), mas **não apaga** coleta marcada como real.
- ⚠️ **Nenhum caminho de simulação, coleta ou replay envia ordens reais** — a ponte só é tocada quando há conexão MT5 estabelecida.

---

## 📱 4. Responsividade & Otimizações Mobile

- **Altura Dinâmica (`100dvh`)**: Elimina cortes e saltos causados pelas barras dos navegadores mobile (iOS Safari e Android Chrome).
- **Viewport Anti-Zoom**: `<meta name="viewport" content="... maximum-scale=1.0, user-scalable=no, viewport-fit=cover">` evita zooms acidentais por toque duplo.
- **Barra de Navegação Inferior Móvel**: Barra fixa no rodapé (`bottom-0`) para celulares com acesso rápido a:
  - Gráfico (`chart`)
  - Fluxo (`tape`)
  - Curva de Patrimônio (`equity`)
  - Ordens (`stats`, com pulso indicador de posições abertas)
  - Ajustes (`settings`)
- **Gestos Touch no Canvas do Renko**:
  - Arraste com 1 dedo para navegar pelo histórico anterior (Pan horizontal).
  - Pinça com 2 dedos (*Pinch-to-Zoom*) para aumentar ou reduzir a escala dos boxes.
- **Eixo de Preço e Margem Adaptativos**:
  - Eixo de preço reduzido a **64px no desktop e 46px no mobile**, com rótulos centralizados na régua, liberando largura para os tijolos sem cortar os 5 dígitos do Mini‑Índice (`128.500`).
  - Margem direita ajustada de 90px para 50px no mobile.
- **Times & Trades Otimizado**: Ocultamento de colunas de corretoras (`Compradora`/`Vendedora`) no celular, garantindo visibilidade total de Horário, Preço, Quantidade e Agressor sem scroll horizontal.
- **Quadro Flutuante HUD no Mobile**: Transforma-se em uma pílula recolhível de 32px (`Detalhes ▾`), expandindo apenas quando clicada.

---

## 🐍 5. Arquitetura de Integração MT5 (Python Bridge) — Blindada

### 5.1 Topologia real (por que não é `localhost`)
- O **script Python roda no Windows**, onde estão o MT5 e a conta demo da XP — a biblioteca `MetaTrader5` **não existe para Mac/Linux** (e no Mac o MT5 só rodaria via Wine, sem servir para a ponte).
- O servidor escuta em **`0.0.0.0:8765`** (toda a rede local), e o navegador — em qualquer máquina da mesma rede Wi‑Fi — aponta **Ajustes → MT5 Host** para o IP do Windows.
- Bibliotecas do script: `MetaTrader5` e `websockets`. Preenchimento automático de `ORDER_FILLING_RETURN` / `IOC` / `FOK`.

### 5.2 Protocolo de segurança (token + armamento + tetos)
> Motivação: `mt5.initialize()` entra no terminal que já está logado, e **WebSocket não é protegido por CORS** — sem autenticação, qualquer aparelho da rede **ou qualquer site aberto no navegador** poderia enviar `ORDER_SEND` e operar a conta.

- **Handshake obrigatório**: o primeiro quadro precisa ser `{action:'AUTH', token, armed}`; a ponte responde `AUTH_RESULT{ok, requireToken, armed, maxContractsPerOrder, maxOrdersPerMinute}`. Token errado encerra com `close(code=4001, reason="token invalido")`. A conferência usa `secrets.compare_digest`.
- **Armamento**: `ARM` / `DISARM` → `ARM_RESULT`. O navegador envia automaticamente conforme o liga/desliga do robô (`config.active`). Sem armado, **entrada nova é recusada**; **saídas seguem liberadas** (`ORDER_MODIFY_SL`, `CLOSE_POSITIONS`, `ORDER_PARTIAL_CLOSE`) para você sempre conseguir se proteger.
- **Tetos impostos pela própria ponte** (`check_trade_allowed`), nesta ordem: autenticado → armado → `mt5MaxContractsPerOrder` (padrão **2**) → `mt5MaxOrdersPerMinute` em janela deslizante de 60 s (padrão **12**). Recusa volta como `RISK_REJECT{action, reason, comment}`.
- **Estado por conexão** (`CLIENT_STATES`) e log no console do Windows com o **IP de origem** (`get_peer_ip`) de cada recusa.
- **Vazamento de ticks fechado**: `broadcast_to_web` ignora clientes não autenticados.
- **Compatibilidade legado**: `AUTH_TOKEN = ""` mantém o script antigo funcionando (auto-autenticado e armado). O app detecta ponte antiga quando `ACCOUNT_INFO` chega **antes** de `AUTH_RESULT` e avisa “⚠️ PONTE SEM AUTENTICAÇÃO (SCRIPT ANTIGO)”.

### 5.3 Onde vive o segredo
- `src/utils/bridgeSecurity.ts`: `generateBridgeToken()` (28 caracteres via `crypto.getRandomValues`, alfabeto sem `0/O/1/l/I`), `getBridgeToken()` (gera e persiste se não existir), `setBridgeToken()`, `rotateBridgeToken()`, `maskBridgeToken()`.
- Chave **`fluxo_bridge_token_v1`**, **deliberadamente fora do `AutomationConfig`**: trocar de preset ou importar JSON nunca sobrescreve (nem exporta junto) o token da ponte.

### 5.4 Interface de operação
- **Aba Guia → card “Segurança da Ponte (token + travas de risco)”**: estado atual em chips, campo do token editável, mostrar/esconder, copiar, “Gerar token novo”, os dois tetos numéricos, o trecho pronto de `New-NetFirewallRule` restringindo a 8765 e os avisos “nunca exponha a porta na internet” / “não compartilhe o `.py`”.
- **Header**: o selo de conexão mostra `· ARMADO` ou `· SEGURO` com descrição contextual.
- **Toasts** de `AUTH_RESULT`, `ARM_RESULT` e `RISK_REJECT` (“🔒 PONTE RECUSOU O TOKEN”, “🔓 PONTE AUTENTICADA E ARMADA”, “⛔ ORDEM RECUSADA PELA PONTE” + motivo).
- **Diagnóstico**: teste de ping e status de conexão na própria aba Guia.

---

## 👥 6. Módulo SaaS, Licenciamento & Admin Master

- **Administrador Master**: Marcos Camargo (`marcos.a.camargo@gmail.com`), acesso irrestrito e vitalício.
- **Tarja / Badge Compacta no Canto Superior Direito**:
  - Pílula elegante e proporcional (`px-2.5 py-1 text-[11px]`) com ícone `ShieldCheck`, label `Admin Master`, pulso indicador e chevron.
  - Alocada no extremo direito do Header (`top-right corner`), liberando espaço no centro da barra para os controles de mercado e abas.
  - Ao clicar, expande o card com detalhes completos de licenciamento (nome, email, status vitalício e alternância de contas para testes).
- **Controle de Tempo de Uso**:
  - Validação de expiração por data (`validUntil`).
  - Ao expirar, ativa automaticamente a tela de `SubscriptionPaywall`.
  - Simulador de checkout com PIX (copia-e-cola) e Cartão (+30d, +90d, +365d).
- **Painel Master do Administrador**:
  - Métricas de faturamento MRR estimado, total de assinantes, clientes ativos e a expirar.
  - Ações rápidas de extensão de prazo (`+30d`, `+7d`), bloqueio/desbloqueio e exclusão de contas.

---

## 💾 7. Registro e Memória Persistente do EA & Controle Total pelo Operador

- **Persistência Automática na Memória Local (`localStorage`)**:
  - Toda alteração feita pelo operador nos parâmetros é imediatamente registrada e persistida no navegador através do serviço `EaConfigService`.
  - Ao recarregar a página ou abrir o terminal em outra sessão, o EA restaura exatamente a última configuração estabelecida.
- **Badge de Status no Topo (Header)**:
  - Botão/badge interativo no Header exibindo: `EA: [Nome do Perfil] 🟢`, com pulso indicador de configuração ativa.
- **Perfis Estratégicos com 1-Clique**:
  - `10R Padrão Institucional (Recomendado)`: Pullback na abertura, SL 100 pts, TP 150 pts, Parcial +50 pts (Breakeven +5 pts offset) e Trailing Stop de 50 pts.
  - `10R Scalper Agressivo`: A mercado no fechamento, alvos de 75 pts, parcial em 35 pts com BE +0 pts e Delta 150 ctros.
  - `10R Trend Follower`: Reteste a 50% do box (25 pts), SL 150 pts, TP 250 pts, Parcial 75 pts e Trailing longo de 75 pts.
  - `Hedge Multi-Posição B3`: Até 4 posições simultâneas (compra e venda), parciais e stops gerenciados por ticket individual.
- **Perfis Customizados do Operador**:
  - O operador pode salvar suas próprias configurações com nomes personalizados (ex: "Setup 10R Marcos Scalper"), alterná-las rapidamente ou excluí-las.
- **Exportação & Importação JSON**:
  - Botões para baixar arquivo `.json` de backup e carregar configurações externas.
- **Controle Integral pelo Operador**:
  1. Identificação: Código do Ativo, Tamanho do Renko (pts e R), Lote de Contratos, `Magic Number` (ex: 102030) e Comentário da Ordem MT5.
  2. Disparo: Reteste/Pullback na Abertura (ou % do box) vs A Mercado no Fechamento, Validade da Ordem Limitada em boxes, Delta Mínimo de Agressão e Exigência de CVD em Nova Máxima/Mínima.
  3. Gerenciamento de Risco: Stop Loss (pts e R$), Take Profit (pts e R$), Realização Parcial (pts e ctro), Breakeven Automático com offset de taxas, Trailing Stop móvel, Limite Diário de Perda/Ganho e Trava Máxima de Trades no Dia.
  4. Janela de Horários Day Trade (B3): Início das operações (ex: 09:05 pós-leilão), Fim para Novas Entradas (ex: 17:00) e Horário de Zeragem Compulsória (ex: 17:45).
  5. Execução MT5: Modo Hedge vs Netting, Posições Simultâneas e Ação em Sinal Oposto.

---

## 📁 8. Estrutura de Arquivos do Projeto

```text
/
├── index.html                        # Entry point com meta tags mobile (100dvh e anti-zoom)
├── metadata.json                     # Metadados e permissões do applet
├── package.json / bun.lock           # React 19, Recharts 3.x, Tailwind CSS v4, Lucide Icons, jspdf/html2canvas
├── vite.config.ts                    # Porta 3002 e --host=0.0.0.0 (para abrir do celular e de outra máquina)
├── .env.example                      # GCP_USER_METADATA_URI (apenas do AI Studio; nada de segredo real aqui)
├── EVOLUCOES_DETALHADAS.md           # Diário de obra: causa raiz, implementação e verificação de cada ciclo
├── PROJECT_SUMMARY.md                # Estado atual consolidado (este arquivo)
├── PROJECT_CONSOLIDATION_CHAT_SEED.md# Prompt mestre para retomar em bate-papo novo
└── src/
    ├── main.tsx                      # Bootstrap (sem StrictMode, para não duplicar loops de tick)
    ├── index.css                     # Tailwind v4 + @media print do dossiê
    ├── App.tsx                       # ≈3.0k linhas: ticks, estado das ordens, WebSocket MT5, abas, bottom nav, toast
    ├── types/
    │   ├── trading.ts                # RenkoBox (regimeFactor, isStaticContext), Tick, TradeOrder (role MAIN/PYRAMID, PENDING_LIMIT), AuditEvent, AutomationConfig
    │   ├── auth.ts                   # Usuários, licenças e transações SaaS
    │   └── drawing.ts                # Formas desenhadas no canvas (linha, retângulo, fibra, zona)
    ├── services/
    │   ├── eaConfigService.ts        # Persistência do config, presets, perfis customizados e merge defensivo de defaults
    │   ├── authService.ts            # Licenças, contagem de dias e personas (⚠️ maquete em localStorage)
    │   ├── orderAuditService.ts      # Livro de auditoria intraday, métricas e CSV padrão BR (UTF-8 BOM, `;`)
    │   └── seriesCollectorService.ts # Coletor multi-série: seis motores, marcas real/replay e snapshot persistido
    ├── utils/
    │   ├── renkoCalculator.ts        # Construção dos boxes Renko + CVD/delta por box e Heikin-Ashi de fluxo
    │   ├── barEngines.ts             # Motores de barra das séries (Renko 10R, Renko 15R, Range, Tempo…)
    │   ├── convergenceEvaluator.ts   # Regra de confluência preço × fluxo que qualifica o sinal (com limiar adaptativo)
    │   ├── sessionRegime.ts          # Medidor de regime de sessão: fator de volume/direção que adapta o Delta Mínimo
    │   ├── marketSimulator.ts        # Feed autônomo de ticks simulando o WIN$ (dias equilibrados alta/baixa/lateral)
    │   ├── paperStrategyBot.ts       # Robô sombra: espelho fiel das regras do terminal (mesma proteção da mãe)
    │   ├── sessionRules.ts           # Trava de fim de pregão 17:30 → 18:05 (DAY_CLOSE / DAY_CLOSE_FORCED)
    │   ├── bridgeSecurity.ts         # Token da ponte (gerar, ler, rotacionar, mascarar) em fluxo_bridge_token_v1
    │   └── pythonScriptGenerator.ts  # Gera o .py da ponte MT5 já com AUTH/ARM/tetos — o script não vive no repo
    └── components/
        ├── Header.tsx                # 3 zonas, selo de conexão MT5 (· ARMADO / · SEGURO), badge do EA, PDF — botões clean (chrome neutro, cor só no acento)
        ├── RenkoFlowChart.tsx        # ≈2.8k linhas de canvas: séries, 2 divisores arrastáveis, escalas adaptativas, zoom multidia (3000 tijolos), engrenagem de ajustes, linhas de ordens, desenho
        ├── ChartControlSidebar.tsx   # Controles de série, escala, preset de janela e reset
        ├── DadosPanelWindow.tsx      # Janela flutuante arrastável que hospeda o painel de dados
        ├── RenkoBoxCard.tsx          # Quadro do box (fixo no canto, HUD mobile e variante `window`)
        ├── DrawingOverlay.tsx / DrawingToolbar.tsx # Camada e barra de rabiscos técnicos sobre o gráfico
        ├── TimesAndTrades.tsx        # Fita de negócios ao vivo
        ├── AutomationPanel.tsx       # Ajustes: blocos por estratégia, proteção da mãe, limites da ponte, perfis
        ├── SimulatorView.tsx         # Aba Simulador: feed, cartões dos motores, replay e modo OPERA
        ├── SeriesComparisonView.tsx  # Aba Comparativo: métricas lado a lado por série
        ├── TechnicalEvaluationView.tsx # Aba Avaliação Técnica: recortes por saída/papel/direção/horário + Regime do Mercado
        ├── EquityCurveView.tsx       # Curva de patrimônio, High-Water Mark e underwater drawdown
        ├── OrdersAndStats.tsx        # Posições fechadas e cartões de métricas
        ├── IntradayOrderAudit.tsx    # Auditoria, filtros, timeline e exportação CSV
        ├── PythonScriptView.tsx      # Visualiza/baixa o .py gerado e mostra o token da ponte
        ├── DocumentationView.tsx     # Manual de instalação + card “Segurança da Ponte”
        ├── ProjectDossierPdfModal.tsx# Dossiê executivo em A4 (@media print)
        ├── AdminPanel.tsx / SubscriptionPaywall.tsx / SubscriptionStatusBadge.tsx # SaaS (maquete)
```

> ⚠️ Não existe `bot_mt5_convergencia_10r.py` no repositório: o script da ponte é **gerado em runtime** pelo `pythonScriptGenerator.ts` e baixado pelo navegador para dentro do Windows. Ele carrega o token do seu navegador — por isso não deve ser commitado nem compartilhado.

---

## 🆕 9. Resumo dos últimos ciclos

> Detalhamento completo, com causa raiz e evidência de verificação, em `EVOLUCOES_DETALHADAS.md`.

### Ciclo 7 (30/10/2026) — limiar adaptativo, Avaliação Técnica e gráfico de estudo

- ✅ **Limiar Adaptativo de Regime** (`sessionRegime.ts`): Delta Mínimo vira `±base × fator do momento` (curva em U de volume + assimetria buy/sell, clamp 0,5×–3,0×), válido para as duas estratégias e para as três séries do coletor; medição sempre ativa; `RegimeMeter` equivalente embutido no script MT5 gerado.
- ✅ **Aba Avaliação Técnica** (`TechnicalEvaluationView.tsx`): recortes por motivo de saída, papel, direção e horário + seção Regime do Mercado lida dos medidores vivos; CSV ganhou a coluna FATOR REGIME.
- ✅ **Simulador equilibrado**: ~40% dias de alta / ~40% de baixa / ~20% laterais (sem viés comprador), para testar o adaptativo de verdade.
- ✅ **Replay com dia anterior estático**: contexto processado de uma vez, sem operar e **sem marcas ▲/▼** (`isStaticContext`), linha âmbar ABERTURA separando os dias; paridade de janela de entradas (hora da barra no coletor = hora do tick no terminal).
- ✅ **Zoom multidia para estudo**: modo Preencher honra o "Tijolos X" (até 3000 ≈ 15 dias), piso de zoom 0,15, auto‑ajuste de passo até 1px; chave `fluxo_renko_visible_count_v3`.
- ✅ **Engrenagem ⚙ de ajustes** sobreposta e centralizada na régua de preços (painel retrátil com tudo rotulado), régua 64/46px com rótulos centralizados, rodapé‑legenda removido.
- ✅ **Header clean**: botões Robô (só ponto colorido + On/Off) e Pausar/Rodar com chrome neutro, palavra "feed" removida, ícones do menu todos cinzas (Dados e Box Renko perderam o verde).

### Ciclo 6 (29–30/10/2026) — o que já havia sido consolidado

- ✅ **Ponte WebSocket blindada**: handshake `AUTH` com token, `ARM`/`DISARM`, tetos de contratos e de ordens/min impostos pelo próprio Python, `RISK_REJECT` com motivo, log por IP e fim do vazamento de ticks. Token editável/rotacionável na aba Guia.
- ✅ **Proteção da Ordem Mãe em dois estágios** (gatilho → piso → acompanhamento), corrigindo o trailing que estava morto na Pirâmide e o stop que nunca era criado em venda (`currentSL = 0`).
- ✅ **Tipo de entrada na Pirâmide**: `MARKET_ON_CLOSE`, `BOX_50_LIMIT` e `BOX_OPEN_LIMIT`, com validade em boxes e TP/SL ancorados no preço real de execução.
- ✅ **Coletor honesto**: marca `real` por dia impede o replay de apagar pregão verdadeiro; replay progressivo; modo **OPERA** roda a estratégia pelo mesmo caminho do terminal.
- ✅ **Trava de 17:30** compartilhada (`sessionRules.ts`) entre terminal e robôs sombra.
- ✅ **Gráfico**: dois divisores arrastáveis idênticos (preço↔fluxo e Heikin-Ashi↔histograma), ambos com arraste no dedo, escalas adaptativas com passo “limpo”, régua `Δ` no histograma e etiquetas de faixa.
- ✅ **Ajustes por estratégia** (Pirâmide com bloco dedicado) e **pop-up de execução discretizado** (linha fina, sem perder o preço de entrada).
- ✅ **Série TEMPO fora do gráfico** (só Pontos e Range), continuando no coletor como histórico.
- ✅ **Consolidação**: commit `3037273` em `origin/main` (3.005 inserções / 563 remoções), com `npx tsc --noEmit` limpo e build OK.

---

## 🛠️ 10. Correções Recentes & Melhorias Operacionais

### A. Diagnóstico & Correção das Linhas de Ordens no Gráfico
- **Causa Raiz**: O filtro de ordens abertas em `App.tsx` (`orders.filter(o => o.status === 'OPEN')`) excluía ordens no modo de pullback (`PENDING_LIMIT`). Além disso, ao recarregar a página com ordens encerradas na memória, nenhuma ordem aberta existia no estado inicial.
- **Solução Implementada**:
  - `openOrders` agora inclui ordens com status `OPEN` e `PENDING_LIMIT`.
  - Inclusão de ordem ativa no dataset de inicialização para visualização imediata das linhas na abertura do terminal.
  - Desenho aprimorado em `RenkoFlowChart.tsx`: linhas sólidas/tracejadas com tags descritivas à esquerda (`🟢 COMPRA 2ct @ 128.500`, `⏳ RETESTE LIMITE`, `🎯 PARCIAL (+50p)`, `🛑 STOP LOSS`, `🛡️ SL BREAKEVEN (+5p)` e `🏁 TAKE PROFIT`), badges no eixo Y e setas indicadoras fixadas nas bordas se SL ou TP estiverem fora do zoom vertical atual.
  - Botão de alternância rápida na barra do gráfico: **`Linhas Ordens (N ativas)`** e botão **`+ Ordem Teste`**.

### B. Correção da Lixeira dos Perfis Salvos (Eliminação de `window.confirm`)
- **Causa Raiz**: A função `handleDeleteCustomProfile` utilizava `window.confirm()`, que em ambientes de iframe com sandbox (como a prévia do AI Studio) é bloqueada pelo navegador sem emitir feedback, impedindo a exclusão.
- **Solução Implementada**:
  - Remoção de todos os diálogos nativos bloqueados (`window.confirm` e `alert`).
  - Criação de modais in-app elegantes com confirmação explícita (`profileToDelete`), remoção da memória local via `EaConfigService.deleteCustomProfile(id)`, atualização imediata da lista de perfis salvos e fallback automático para o setup recomendado caso o perfil ativo seja excluído.
  - Modal in-app de confirmação também para restauração dos padrões de fábrica (`handleResetToDefaults`).

### C. Dossiê Executivo em PDF & Arquivo de Seed de Continuidade
- Criação de `ProjectDossierPdfModal.tsx` acessível via botão na Top Bar (**"PDF Dossiê"**) e no Guia MT5.
- Layout de alta resolução formatado com `@media print` para salvar como PDF A4 com diagramas, tabelas de parâmetros, fórmulas do Renko 10R e do Heikin-Ashi tricolor, manual de risco e árvore completa de arquivos.
- Criação do arquivo `PROJECT_CONSOLIDATION_CHAT_SEED.md` com o prompt pronto para cópia e inicialização em qualquer nova conversa.

### D. Boleta Rápida de Compra e Venda Fixa no Canto Superior Esquerdo do Gráfico
- **Aprimoramento**: Os botões de envio rápido de ordens a mercado de **COMPRA** (verde esmeralda com indicação de contratos) e **VENDA** (vermelho carmim com indicação de contratos) foram integrados diretamente no interior do container do gráfico Renko no canto superior esquerdo (`absolute top-2.5 left-2.5 z-30`).
- **Visibilidade Contínua**: Permanecem sempre visíveis e acessíveis para o operador independente da rolagem horizontal da barra de ferramentas, tamanho de viewport ou zoom aplicado.
- **Ações Rápidas Integradas**:
  - Botão de **COMPRA** com seta e quantidade de contratos configurada.
  - Botão de **VENDA** com seta e quantidade de contratos configurada.
  - Botão de **ZERAR** dinâmico (visível com badge pulsante assim que ordens/posições abertas existem).
  - Botão de **+ Teste** (quando sem ordens) para inspeção imediata das linhas visuais de trade.
- **Harmonização com Escalas**: O badge de escala manual customizada foi reposicionado para fluir ao lado ou abaixo da boleta sem sobreposição visual.

### E. Estratégia Quantitativa: Pirâmide & Confluência de Fluxo Renko 10R (TP 50p + Surfe até Inversão)
- **Conceito & Racional Quantitativo**:
  - Operação na confluência do gráfico de preços Renko 10R (50 pts por box) e do fluxo de agressão / Heikin-Ashi.
  - **Na Virada de Tendência (Inversão)**: Encerra sumariamente todas as ordens abertas da direção oposta (ordem mãe e pirâmides) e abre imediatamente a **ORDEM MÃE** (`role: 'MAIN'`).
  - **Ordem Mãe (Surfe)**: Não possui Take Profit fixo (`takeProfit = 0`) nem Stop Loss fixo em pontos (`stopLoss = 0`). Ela surfa a pernada inteira e permanece aberta até a virada de fluxo/mercado oposta.
  - **Ordens de Pirâmide (`role: 'PYRAMID'`)**: A cada fechamento de box consecutivo na mesma direção (ex: cada bloco verde no fluxo altista), o robô executa uma nova compra com **Take Profit cirúrgico de 50 pontos** (`takeProfit = price + 50`), embolsando o valor de 1 box 10R.
  - **Sincronismo de Stops (Zero Stop Fixo em Pontos)**: Nem a ordem mãe nem as ordens de pirâmide dependem de stop em pontos no book; caso o mercado reverta antes de atingir o TP de uma pirâmide, a inversão de cor do box ou fluxo encerra tudo com o motivo `FLIP_REVERSAL`.
  - **Visualização Dedicada no Gráfico**:
    - Tag verde/vermelha proeminente para a ordem mãe: `🟢 COMPRA MÃE (SURFE)` / `🔴 VENDA MÃE (SURFE)`.
    - Tags numeradas para cada sub-entrada: `🔺 PIRÂMIDE #N (+50p TP)` com sua respectiva linha de Take Profit pontilhada a 50 pontos.
    - Floating banner no topo informando o estado: `📈 TENDÊNCIA DE ALTA: Surfe Mãe ativo + N Pirâmides (+50p TP)` e botão de zeragem de emergência.
  - **Ponte MT5**: o script gerado reconhece as tags de comentário `MAIN` / `PYRAMID` e executa encerramento em massa na inversão (`execute_pyramid_confluence`), mantendo o controle por ticket em hedge/ netting.

### F. Chaves de `localStorage` (mapa completo da persistência)

| Chave | Conteúdo |
| --- | --- |
| `fluxo_renko_ea_config_v3` | Configuração ativa do robô (`AutomationConfig`) |
| `fluxo_renko_ea_profiles_v3` | Perfis customizados salvos pelo operador |
| `fluxo_renko_chart_scales_v2` | `scaleX`, `scaleY`, `scaleFlow`, `flowPaneRatio`, `flowPanOffset`, `haHistSplit` |
| `fluxo_renko_visible_count_v3` | Janela "Tijolos X" do gráfico (padrão 250 desktop / 50 mobile; teto 3000 — modo estudo) |
| `fluxo_renko_spacing_mode_v2` | Modo de espaçamento (Preencher/Compacto; padrão `fill`) |
| `fluxo_renko_flow_mode_v1` | Modo do painel de fluxo (Heikin-Ashi / Delta / Híbrido) |
| `fluxo_bridge_token_v1` | **Token da ponte** — fora do config de propósito, para nunca ser exportado em JSON |
| `fluxo_renko_intraday_audit_v3` | Livro de auditoria intraday |
| `fluxo_series_collector_v1` | Snapshot do coletor multi-série (com marca `real` por dia) |
| `fluxo_renko_hud_pos_v1` | Posição do quadro HUD/Box Renko |
| `fluxo_chart_series_v1` / `fluxo_chart_range_pts_v1` / `fluxo_chart_time_sec_v1` | Série ativa do gráfico e escalas de Range/Tempo |
| `fluxo_dados_window_v1` / `fluxo_renko_box_window_v1` | Posição das janelas flutuantes (Dados e Box Renko) |
| `fluxo_replay_days_v1` / `fluxo_replay_operate_v1` / `fluxo_sim_speed_v1` | Replay: dias, modo OPERA e velocidade |
| `quant_terminal_current_user_v2` / `quant_terminal_users_v2` / `quant_terminal_transactions_v2` | SaaS (administrador, clientes e transações) |

---

## 🚀 11. Instruções para Retomada em Novo Bate-Papo

Ordem de leitura da documentação: **`PROJECT_SUMMARY.md`** (estado atual) → **`EVOLUCOES_DETALHADAS.md`** (por que cada coisa é como é) → **`PROJECT_CONSOLIDATION_CHAT_SEED.md`** (prompt para colar na conversa nova).

```text
Olá! Estou continuando o projeto "Fluxo & Renko 10R - MT5 Quant Terminal" (B3 WIN$, Vite + React 19 + TS,
porta 3002 com --host=0.0.0.0; a ponte MT5 Python roda no Windows e é GERADA em runtime, não existe no repo).
A documentação está consolidada em três arquivos na raiz: PROJECT_SUMMARY.md (estado atual),
EVOLUCOES_DETALHADAS.md (histórico com causa raiz) e PROJECT_CONSOLIDATION_CHAT_SEED.md (prompt de retomada).
Regras do projeto: toda a UI e os comentários em português; rodar `npx tsc --noEmit` a cada entrega;
simulação, coletor e replay jamais podem tocar a corretora real; a ponte WebSocket exige token + ARM e só
receita ordens quando o robô está armado; commits e pushes só quando eu pedir explicitamente.
Favor ler a documentação, alinhar o contexto e me avisar quando estiver pronto.
```

### Pendências conhecidas (para não redescobrir)
- Módulo SaaS/paywall continua **maquete em `localStorage`**, sem backend nem gateway de pagamento real.
- A pergunta de infraestrutura “até 100 clientes pagantes” segue em aberto (hoje cada cliente precisa do próprio Windows com MT5 logado).
- Recomenda-se **rotacionar o token** da ponte antes de operar em conta real e aplicar a regra de firewall `New-NetFirewallRule` na porta 8765.
- ✅ Card “Segurança da Ponte” e o selo `· ARMADO`/`· SEGURO` do Header **reconferidos no navegador** em 30/10/2026 (recarga limpa + stub WebSocket local que só ecoa o protocolo, sem tocar o corretor).
