# Evoluções do Sistema Flow Quant B3 & Robôs Hedge (Passos 1 a 4)

> **Contexto de Partida para Nova Conversa:** `aba específica dos EAs`  
> **Conta MT5:** `50534540 (XPMT5-DEMO)`  
> **Data de Consolidação:** 13/11/2026  
> **Status:** Integrado, auditado e validado em replay real e demo XP

---

## 1. Resumo Executivo das Implementações

Nesta etapa, consolidamos a arquitetura de **Robôs Hedge Direcionais** independentes para a plataforma B3/MT5, integrando o motor analítico de fluxo/Renko diretamente com a execução no MetaTrader 5 e com a interface visual do React.

### Arquitetura de Magic Numbers e Isolamento:
- **Robô Principal (Estratégia Pirâmide/Surfe):** Magic `102030` (ou customizável via config `DEFAULT_MAGIC_NUMBER = 101010`).
- **Boleta Manual / Ordens Rápidas:** Magic `999999` (isoladas do robô automático).
- **Robô Direcional de Compra (RoboCompra):** Magic `100001` (comentário `RCOMP_<SYM>_BOX<N>`).
- **Robô Direcional de Venda (RoboVenda):** Magic `100002` (comentário `RVEND_<SYM>_BOX<N>`).

---

## 2. Detalhamento Técnico das Evoluções

### A. Criação do Serviço e Motor dos Robôs (`directionalRobotService.ts`)
- Implementada classe `DirectionalRobot` que encapsula o ciclo de vida e estado de cada robô direcional (`BUY_ROBOT` e `SELL_ROBOT`).
- Suporte a:
  - Registro de intenções (`DirectionalIntent`) e posições (`DirectionalPosition`).
  - Marcação a mercado tick a tick com Stop Loss e Take Profit dedicados.
  - Fechamento por sinal oposto (`onCloseOpposite`), permitindo liquidar posições quando o robô contrário emite sinal no funil, mantendo as posições do outro robô 100% intactas.
  - Validação estrita de sanidade de preço e teto de contratos por ativo (`WINZ26`, `WDOZ26`, `BITX26`).
  - Método `resetBook()` para higienização em inícios de replay/sessões.

### B. Interface e Controles no Painel de Ajustes (`AutomationPanel.tsx`)
- Adicionados cartões dedicados para **RoboCompra** e **RoboVenda** na aba Ajustes (`AutomationPanel.tsx`).
- Botões independentes de controle com cores de destaque (`emerald` e `rose`):
  - **`▶ Ativar`** / **`⏸ Pausar`** por magic number.
- Exibição de métricas ao vivo:
  - **Status:** `ATIVO` / `PAUSADO`
  - **Último sinal:** Direção, box index e preço
  - **Intenções:** Contagem de gatilhos acionados
  - **Posições abertas:** Contratos e contagem atual
  - **PnL realizado (R$):** Lucro/prejuízo liquidado
  - **Fechamentos:** Contagem total de saídas

### C. Integração com a Tela, Gráfico e Boleta (`App.tsx`)
- **Auto-reconexão Contínua da Ponte:** Front-end agora reconecta automaticamente ao WebSocket da ponte MT5 em caso de desconexão ou erro de rede a cada 2,5 segundos.
- **Injeção no Livro Global (`orders`):** Toda posição aberta ou encerrada pelos robôs hedge é imediatamente sincronizada no array `orders` do React. Isso garante:
  - Plotagem visual das setas e linhas de execução no gráfico Renko.
  - Atualização dos contratos, flutuante e PnL da sessão no painel Hedge da Boleta.
- **Persistência de Instância dos Robôs:** Uso de `useRef` para evitar que os robôs resetem seu estado ao longo dos re-renders.
- **Sincronização 60 FPS:** Adicionada chamada `syncDirectionalSnapshots` no buffer `requestAnimationFrame`, atualizando a UI em tempo real sem travar a thread principal.
- **Preservação do Contexto D-1 no Replay:** Ao selecionar um pregão avulso no seletor histórico (ex.: Flow1, Flow2), o pregão anterior é automaticamente desenhado como contexto estático (`isStaticContext`), preservando as referências de suporte e resistência.

### D. Validação Automatizada de Isolamento (`testeRobosHedgeReplay.ts`)
- Script automatizado de ensaio que lê os ticks reais do cache rolante de 10 dias (`data/pregoes/` e banco SQLite):
  - **Passe 1 (Normal):** RoboCompra e RoboVenda ativos simultaneamente operando compras e vendas isoladas.
  - **Passe 2 (`onCloseOpposite=true`):** Confirmação de fechamento pelo motivo `OPPOSITE_ROBOT_SIGNAL` e prova matemática de que nenhuma posição do Robô 100002 foi tocada pelas saídas do 100001.
  - **Passe 3 (Pausados):** Verificação de zero intenções geradas com robôs pausados.
  - Relatório PASS/FAIL com saída zero (100% de aprovação).

### E. Autorização na Ponte Python MT5 (`bot_mt5_ciclo15.py`)
- Adicionadas regras de autorização de comentários e magics:
  - `is_operator_order` agora reconhece e autoriza sem conflitos prefixos `RCOMP_`, `RVEND_` e os magics `100001` e `100002`.

---

## 3. Diretrizes para a Nova Conversa: "Aba Específica dos EAs"

Na próxima conversa, focaremos na **criação de uma aba dedicada exclusiva para os EAs / Robôs**, separando-a do painel geral de ajustes.

### Metas Prioritárias:
1. **Aba Dedicada na Navegação Principal:**
   - Adicionar uma nova aba na barra superior (ex.: `Robôs EAs` ou `Hedge EAs`), paralela a `Gráfico`, `Análise`, `Ajustes`, `Auditoria`.
2. **Dashboard Visual dos EAs:**
   - Gráfico de curva de capital (equity curve) individual para cada Magic Number (`100001` e `100002`).
   - Tabela detalhada de trades em tempo real exclusiva dos robôs hedge.
   - Parâmetros individuais por robô (SL, TP, breakeven, trailing stop, tamanho de lote e horário de operação independentes para compra e venda).
3. **Comutador de Modo:**
   - Alternância entre Simulação / Paper Trading e Envio Real para MT5 de forma explícita por robô.
