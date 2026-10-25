# 📊 Memória & Documentação do Projeto: Fluxo & Renko 10R MT5 Quant Terminal

> **Documento de Continuidade e Memória Operacional**: Este arquivo reúne todo o histórico de desenvolvimento, regras de negócio, lógica quantitativa, arquitetura técnica e avanços recentes para restauração imediata de contexto em novos bate-papos.

---

## 🎯 1. Visão Geral do Sistema

O **Fluxo & Renko 10R - MT5 Quant Terminal** é uma plataforma quantitativa profissional de alta performance para operações no Mini-Índice B3 (`WIN$`). O terminal opera combinando análise de fluxo atemporal com gráfico atemporal de tijolos Renko, enviando ordens automatizadas via ponte WebSocket para o MetaTrader 5.

### Pilares Centrais:
1. **Gráfico Renko 10R (50 pontos)**: Construção atemporal com tijolos finos, corpo 100% preenchido e aproximação temporal progressiva.
2. **Fluxo & Tape Reading Tick-a-Tick**: Agressão compradora vs. vendedora, saldo Delta e CVD (*Cumulative Volume Delta*).
3. **Gatilho de Convergência com Entrada no Pullback**: Ordem posicionada na abertura do box (reteste), reduzindo slippage.
4. **Gerenciamento de Risco Institucional**: Stop Loss, Take Profit, Realização Parcial (com Stop no Breakeven) e Trailing Stop dinâmico.
5. **Curva de Patrimônio Acumulado (Equity Curve)**: Rastreamento trade-a-trade, High-Water Mark, Underwater Drawdown e métricas de risco.
6. **Responsividade Mobile Completa**: Gestos touch (Pan e Pinch-to-Zoom), Bottom Navigation Bar e HUD adaptativo.
7. **Integração MetaTrader 5 (Python Bridge)**: Comunicação bidirecional WebSocket (`ws://localhost:8765`) com suporte a contas Hedge.
8. **Módulo SaaS & Painel Master do Administrador**: Licenciamento por dias de uso, Paywall com checkout PIX/Cartão e gestão de clientes.

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
    - Gestos de pinça touch (Pinch vertical no celular ajusta escala Y, Pinch horizontal ajusta escala X).
    - Persistência automática das preferências de escala (`scaleX` e `scaleY`) em `localStorage`.
- **Quadro Informativo Box Renko**:
  - Desktop: Fixo permanentemente no canto inferior direito (`bottom-3 right-[88px]`), exibindo OHLC, CVD, Delta e convergência.
  - Mobile: Pílula compacta recolhível (`Detalhes ▾`) no rodapé para não cobrir o gráfico.

### B. Saldo de Agressão & CVD (Times & Trades)
- Cada negócio recebido é classificado pelo agressor:
  - **BUY**: Comprador agrediu o book de venda (Delta positivo).
  - **SELL**: Vendedor agrediu o book de compra (Delta negativo).
- **CVD (Cumulative Volume Delta)**: Soma cumulativa do Delta ao longo da sessão.
- **Filtro de Validação**: Apenas boxes com Delta líquido acima de `minDeltaThreshold` (ex: 250 contratos) qualificam sinal.
- **Painel Inferior de Fluxo, Modo Heikin-Ashi & Escala Ajustável**:
  - Seletor de 3 modos na barra de ferramentas: **`[ Heikin-Ashi | Delta | Híbrido ]`** (preferência persistida em `localStorage`).
  - **Ajuste Dinâmico da Altura da Janela (Divisor Interativo)**:
    - Linha divisora com puxador visual centralizado (`handle` com 3 pontos e cursor `row-resize`).
    - Arrastar o divisor redimensiona a altura da janela de fluxo continuamente entre **18% e 55%** da tela.
    - Presets de 1 clique na barra superior: **`Janela: [ 25% | 33% | 46% ]`**.
    - Duplo clique no divisor restaura a proporção equilibrada padrão de 33%.
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
  - Persistência total de todas as escalas (`scaleX`, `scaleY`, `scaleFlow`, `flowPaneRatio`, `flowPanOffset`) no `localStorage`.


### C. Gatilho de Entrada: Pullback na Abertura do Box
- Ao confirmar o fechamento de um box com fluxo convergente:
  - Em vez de comprar a mercado no topo do box, o terminal emite ordem limite no preço de **abertura do box (reteste de pullback)**.
  - No MT5: Ordem `BUY_LIMIT` ou `SELL_LIMIT`. Se o preço recuar para testar o nível, a ordem é preenchida no melhor preço.
  - Gráfico: Linha tracejada âmbar com alvo de pullback e status `AGUARDANDO RETESTE`.

### D. Gestão de Risco: Ordem Parcial & Trailing Stop
- **Stop Loss Base**: 100 pontos (2 boxes 10R).
- **Take Profit Base**: 150 pontos (3 boxes 10R).
- **Realização Parcial & Breakeven Automático**:
  - Ao atingir `partialPoints` (ex: +50 pts = 1 box a favor), realiza `partialContracts` (ex: 1 contrato).
  - O Stop Loss do saldo remanescente é instantaneamente movido para o **Breakeven (Entrada + 5 pts de offset)**, cobrindo emolumentos e taxas.
- **Trailing Stop Dinâmico (Stop Móvel)**:
  - Ativado a partir de `trailingActivationPoints` (ex: +60 pts a favor).
  - Mantém o Stop Loss a `trailingDistancePoints` (ex: 50 pts) atrás da máxima/mínima alcançada pelo preço, travando lucros crescentes.

### E. Suporte a Contas Hedge
- Permite manter posições compradas e vendidas simultaneamente.
- Envio de ordens no Python com `position = ticket` em `TRADE_ACTION_DEAL` para fechamento individual de posições.

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
  - Eixo de preço reduzido de 80px para 54px em telas `< 640px`, liberando 26px para visualização de candles sem cortar os 5 dígitos do Mini-Índice (`128.500`).
  - Margem direita ajustada de 90px para 50px no mobile.
- **Times & Trades Otimizado**: Ocultamento de colunas de corretoras (`Compradora`/`Vendedora`) no celular, garantindo visibilidade total de Horário, Preço, Quantidade e Agressor sem scroll horizontal.
- **Quadro Flutuante HUD no Mobile**: Transforma-se em uma pílula recolhível de 32px (`Detalhes ▾`), expandindo apenas quando clicada.

---

## 🐍 5. Arquitetura de Integração MT5 (Python Bridge)

- **Script Local**: `bot_mt5_convergencia_10r.py` (código gerado e exportável pelo próprio terminal).
- **Servidor WebSocket Local**: `ws://localhost:8765`.
- **Bibliotecas**: `MetaTrader5` e `websockets`.
- **Preenchimento Automático**: Detecção automática de `ORDER_FILLING_RETURN`, `ORDER_FILLING_IOC` ou `ORDER_FILLING_FOK`.
- **Diagnóstico**: Teste de ping e status de conexão integrados na aba "Guia MT5".

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

```
/
├── index.html                               # Entry point com meta tags mobile (100dvh e anti-zoom)
├── metadata.json                            # Metadados e permissões do applet
├── package.json                             # React 19, Recharts 3.x, Tailwind CSS v4, Lucide Icons
├── PROJECT_SUMMARY.md                       # Memória central do projeto (este arquivo)
├── src/
│   ├── main.tsx                             # Bootstrap da aplicação
│   ├── index.css                            # Estilização global com Tailwind CSS v4
│   ├── App.tsx                              # Componente principal, abas, bottom nav mobile, ticks e estado
│   ├── types/
│   │   ├── trading.ts                       # Tipos quantitativos (RenkoBox, Tick, TradeOrder, AutomationConfig, ConfigPreset)
│   │   └── auth.ts                          # Tipos de usuários, SaaS e pagamentos
│   ├── services/
│   │   ├── authService.ts                   # Persistência localStorage, validação de dias e personas
│   │   └── eaConfigService.ts               # Persistência da última configuração do EA, presets e perfis customizados
│   ├── utils/
│   │   ├── renkoCalculator.ts               # Motor de cálculo de boxes Renko 10R e saldo CVD
│   │   ├── marketSimulator.ts               # Gerador de ticks em tempo real simulando a B3
│   │   └── pythonScriptGenerator.ts         # Gerador do código Python do robô MT5 com horários e Magic Number
│   ├── services/
│   │   ├── authService.ts                   # Gestão de usuários, perfis e assinaturas
│   │   ├── eaConfigService.ts               # Persistência e gerenciamento de perfis de EA
│   │   └── orderAuditService.ts             # Motor de auditoria intraday, cálculo de métricas e exportação CSV
│   └── components/
│       ├── Header.tsx                       # Header com 3 zonas, abas desktop, badge de EA registrado e status MT5
│       ├── RenkoFlowChart.tsx               # Gráfico Canvas Renko 10R, gestos touch e card flutuante fixo
│       ├── TimesAndTrades.tsx               # Fita de agressão tick-a-tick com responsividade mobile
│       ├── EquityCurveView.tsx              # Curva de Patrimônio Acumulado, High-Water Mark e Underwater Drawdown
│       ├── OrdersAndStats.tsx               # Histórico e tabela detalhada de ordens do robô
│       ├── IntradayOrderAudit.tsx           # Livro completo de auditoria intraday, busca, timeline e exportação CSV
│       ├── PythonScriptView.tsx             # Visualizador e exportador do script Python MT5
│       ├── DocumentationView.tsx            # Manual de instalação MT5 e teste de ping WebSocket
│       ├── AutomationPanel.tsx              # Painel mestre do operador com persistência, presets, lixeira in-app e risco
│       ├── ProjectDossierPdfModal.tsx       # Resumo executivo do projeto formatado para impressão em PDF (@media print)
│       ├── SubscriptionStatusBadge.tsx      # Seletor de usuário e status de licença no topo
│       ├── SubscriptionPaywall.tsx          # Tela de bloqueio por expiração com checkout simulado
│       └── AdminPanel.tsx                   # Painel Master para gestão de clientes e receita recorrente
├── PROJECT_SUMMARY.md                       # Documentação viva de continuidade técnica
└── PROJECT_CONSOLIDATION_CHAT_SEED.md       # Prompt mestre para restauração imediata em novos bate-papos
```

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
  - **Ponte MT5**: Script Python atualizado (`bot_mt5_convergencia_10r.py`) com gerenciamento nativo de ordens `MAIN` e `PYRAMID` via tags de comentários e encerramento em massa na inversão (`execute_pyramid_confluence`).

---

## 🚀 11. Instruções para Retomada em Novo Bate-Papo

Ao iniciar um novo bate-papo, utilize o conteúdo de `PROJECT_CONSOLIDATION_CHAT_SEED.md` ou a seguinte mensagem de abertura:

```text
Olá! Estou continuando o desenvolvimento do projeto "Fluxo & Renko 10R - MT5 Quant Terminal".
O projeto está 100% documentado nos arquivos PROJECT_SUMMARY.md e PROJECT_CONSOLIDATION_CHAT_SEED.md na raiz.
Todos os componentes estão funcionais: Renko 10R com Heikin-Ashi tricolor, linhas de ordens com SL/TP/Parcial visíveis, lixeira in-app para perfis salvos, livro de auditoria intraday com CSV, curva de patrimônio, ponte MT5 Python e exportador PDF.
Favor consultar a documentação para alinhar o contexto e me avisar quando estiver pronto.
```
