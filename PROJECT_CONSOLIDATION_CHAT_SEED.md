# 🚀 PROMPT MESTRE DE CONTINUIDADE & CONSOLIDAÇÃO DO PROJETO
## Para migração / inicialização em um Novo Bate-Papo (Chat Seed)

> **Instruções ao Usuário**: Para transferir ou continuar este projeto em um novo bate-papo sem perder nenhum detalhe, copie e cole o bloco delimitado abaixo como a sua primeira mensagem.

---

\`\`\`markdown
# CONTEXTO DE CONTINUIDADE: FLUXO & RENKO 10R MT5 QUANT TERMINAL (B3 WIN$)

Você está assumindo o projeto institucional **Fluxo & Renko 10R - MT5 Quant Terminal**.
Trata-se de uma aplicação web de trading quantitativo de alta performance para o Mini-Índice B3 (WIN$), conectada ao MetaTrader 5 via WebSocket local (Python Bridge).

## 1. ESCOPO & PILARES DA ESTRATÉGIA QUANTITATIVA
1. **Gráfico Renko 10R (50 pontos no Mini-Índice)**:
   - Tijolos com corpo sólido 100% preenchido (#10b981 / #ef4444).
   - Reversão exige 2 boxes (100 pontos).
   - Aproximação temporal progressiva (boxes recentes arejados, compactando-se ao envelhecer).
   - Escalas ajustáveis independentes: Eixo Y (preço), Eixo X (tempo/espaçamento) e Janela de Fluxo.
   - Pílula/Quadro informativo Renko no canto inferior direito.
2. **Painel de Fluxo Heikin-Ashi & Delta/CVD**:
   - 3 modos de visualização selecionáveis na barra: [ Heikin-Ashi | Delta | Híbrido ].
   - Heikin-Ashi de Fluxo com coloração tricolor:
     * 🟢 Verde (#10b981): Subida contínua de agressão compradora.
     * 🔴 Vermelho (#ef4444): Descida contínua de agressão vendedora.
     * ⚪ Cinza (#94a3b8): Reversão de fluxo, absorção institucional ou indecisão.
   - Divisor interativo arrastável (redimensiona entre 18% e 55% da tela) com presets (25%, 33%, 46%).
   - Escala vertical independente do fluxo (+F, -F, reset auto, pan vertical e régua calibrada com badges numéricos).
3. **Gatilho de Entrada por Reteste (Pullback na Abertura)**:
   - Sinal disparado no fechamento de box com fluxo divergente/convergente (mínimo de Delta ±250 ctros).
   - Ordem limite enviada no preço de abertura do box gerador (reteste), reduzindo slippage.
4. **Gestão de Risco Institucional**:
   - Stop Loss base: 100 pontos (2 boxes 10R).
   - Take Profit base: 150 pontos (3 boxes 10R).
   - Saída Parcial: 50 pontos (1 box a favor) com 1 contrato.
   - Breakeven Automático: Stop movido para Entrada + 5 pontos (offset de taxas da B3) imediatamente na execução da parcial.
   - Trailing Stop Dinâmico: Ativação a 60 pontos, mantendo stop a 50 pontos atrás da máxima/mínima.
5. **Livro de Auditoria de Ordens Intraday**:
   - Trilha imutável e cronológica de cada evento por ordem (envio, reteste limite, parcial, breakeven, trailing e encerramento).
   - Exportação em planilha CSV no padrão brasileiro (UTF-8 com BOM, delimitador ponto e vírgula, formatação R$ e pontos).
   - Modal de Timeline cronológica com badges visuais.
6. **Linhas de Ordens no Gráfico**:
   - Entrada/Reteste (Verde/Vermelho ou Âmbar tracejado para PENDING_LIMIT) com tag descritiva à esquerda e badge no eixo Y.
   - Saída Parcial (Ciano tracejado com tag +50p).
   - Stop Loss (Vermelho/Âmbar tracejado com tag SL/Breakeven).
   - Take Profit (Verde tracejado com tag TP +150p).
   - Indicadores fixados nas bordas se SL ou TP estiverem fora da área visível devido ao zoom vertical.
   - Botão de alternar visibilidade ("Linhas Ordens") no topo do gráfico.
7. **Ponte MetaTrader 5 (Python Bridge WebSocket)**:
   - Script Python nativo (\`bot_mt5_convergencia_10r.py\`) ouvindo em ws://localhost:8765.
   - Suporte completo a contas Hedge e Netting, transmissão de ticks reais e retorno de tickets.
8. **Módulo SaaS & Painel Master do Administrador**:
   - Licenciamento por dias restantes, Paywall simulado com PIX e Cartão, e painel para conceder dias e gerenciar usuários.
9. **Exportação Executiva em PDF**:
   - Dossiê técnico completo formatado para impressão ou exportação em PDF via botão na Top Bar e Guia MT5.
10. **Estratégia Pirâmide & Confluência (TP 50p + Surfe até Inversão)**:
    - Compra a cada box verde fechado: primeira ordem abre Ordem Mãe de Surfe (sem TP/SL fixo); boxes verdes seguintes abrem ordens de Pirâmide com TP de +50 pontos.
    - Na virada de fluxo/mercado (box vermelho): zera todas as posições abertas (`FLIP_REVERSAL`) e abre a Ordem Mãe de Venda, empilhando vendas com TP de 50 pontos.
    - Zero stops fixos em pontos: o stop é dinâmico e operado pela reversão do mercado.
11. **Boleta Rápida Integrada no Canto Superior Esquerdo do Gráfico**:
    - Botões sempre visíveis de Compra a mercado, Venda a mercado e Zeragem de Posições fixados no canvas.

## 2. ESTRUTURA COMPLETA DE DIRETÓRIOS E ARQUIVOS
\`\`\`
├── src/
│   ├── types/
│   │   ├── trading.ts                # Interfaces de RenkoBox, Tick, TradeOrder, Eventos de Auditoria e Config
│   │   └── auth.ts                   # Modelos de usuário, assinaturas e perfis SaaS
│   ├── services/
│   │   ├── renkoFlowEngine.ts        # Motor matemático de tijolos 10R e cálculo acumulado do CVD
│   │   ├── eaConfigService.ts        # Persistência no localStorage de presets e perfis customizados
│   │   ├── orderAuditService.ts      # Livro de auditoria intraday e gerador de CSV no padrão brasileiro
│   │   ├── authService.ts            # Gerenciador de licenças, contagem regressiva e controle de acesso
│   │   └── marketSimulator.ts        # Simulador autônomo de mercado B3 tick-a-tick para modo offline
│   ├── components/
│   │   ├── Header.tsx                # Top Bar de 3 zonas, status de conexão MT5, botões e Dossiê PDF
│   │   ├── RenkoFlowChart.tsx        # Gráfico Canvas de alta performance com Renko 10R, Fluxo Heikin-Ashi e Linhas
│   │   ├── AutomationPanel.tsx       # Configuração do EA, perfis salvos com lixeira/modais e import/export JSON
│   │   ├── IntradayOrderAudit.tsx    # Livro de auditoria intraday, filtros, timeline modal e exportação CSV
│   │   ├── EquityCurveView.tsx       # Curva de patrimônio acumulado trade-a-trade, High-Water Mark e Drawdown
│   │   ├── OrdersAndStats.tsx        # Histórico de posições fechadas e cartões de métricas (Win Rate, Profit Factor)
│   │   ├── TimesAndTrades.tsx        # Fita de negócios ao vivo e saldo de agressão institucional
│   │   ├── PythonScriptView.tsx      # Código-fonte Python gerado dinamicamente para download
│   │   ├── DocumentationView.tsx     # Manual técnico passo a passo e testador de WebSocket
│   │   ├── ProjectDossierPdfModal.tsx# Dossiê executivo completo formatado para impressão em PDF
│   │   ├── AdminUsersModal.tsx       # Painel Master do Administrador para gerenciar licenças de clientes
│   │   ├── SubscriptionPaywallModal.tsx # Checkout com simulação PIX (QR Code) e Cartão de Crédito
│   │   └── SubscriptionStatusBadge.tsx  # Badge de status de assinatura no topo
│   ├── App.tsx                       # Orquestrador central de estado, ordens e roteador de abas
│   └── index.css                     # Configurações do Tailwind CSS e regras de impressão (@media print)
├── bot_mt5_convergencia_10r.py       # Script Python autônomo para ponte com o MetaTrader 5
├── PROJECT_SUMMARY.md                # Registro vivo e histórico completo de desenvolvimento
└── PROJECT_CONSOLIDATION_CHAT_SEED.md# Este prompt mestre de inicialização
\`\`\`

## 3. STATUS DAS ÚLTIMAS CORREÇÕES REALIZADAS
- **Bug das Linhas de Ordens**: Corrigido! A propriedade \`openOrders\` agora inclui tanto ordens ativas (\`OPEN\`) quanto ordens limitadas de reteste (\`PENDING_LIMIT\`). A renderização gráfica no Canvas inclui tags laterais com preço, badges no eixo Y e indicadores de borda caso o SL/TP esteja fora do zoom vertical atual.
- **Bug da Lixeira dos Perfis Salvos**: Corrigido! Eliminado qualquer uso de \`window.confirm\` (que falhava silenciosamente em iframes sandboxed). Agora é utilizado um modal in-app elegante com confirmação visual, remoção da memória local, atualização imediata da lista de perfis e fallback automático para o setup recomendado caso o perfil ativo seja excluído.
- **Dossiê em PDF**: Implementado componente \`ProjectDossierPdfModal\` com botão de impressão nativa (\`window.print()\`), download em Markdown e estilos dedicados para A4.
\`\`\`
