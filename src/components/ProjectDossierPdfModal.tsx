import React, { useRef } from 'react';
import {
  FileText,
  Printer,
  Download,
  X,
  CheckCircle2,
  Layers,
  Activity,
  Shield,
  Zap,
  TrendingUp,
  Cpu,
  Database,
  Terminal,
  ExternalLink,
  Copy,
  BookOpen
} from 'lucide-react';
import { AutomationConfig } from '../types/trading';

interface ProjectDossierPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AutomationConfig;
}

export const ProjectDossierPdfModal: React.FC<ProjectDossierPdfModalProps> = ({
  isOpen,
  onClose,
  config,
}) => {
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadMarkdown = () => {
    const mdContent = `# 📊 DOSSIÊ TÉCNICO & MANUAL DE ENGENHARIA QUANTITATIVA
## Fluxo & Renko 10R - MT5 Quant Terminal
**Data do Relatório**: ${new Date().toLocaleDateString('pt-BR')}
**Ativo Homologado**: ${config.symbol} (Mini-Índice B3)
**Setup de Referência**: ${config.profileName} (10R Institucional com Reteste de Pullback)

---

### 1. SUMÁRIO EXECUTIVO & ESPECIFICAÇÃO DO SISTEMA
O **Fluxo & Renko 10R MT5 Quant Terminal** é uma plataforma algorítmica de alta precisão que combina a filtragem de ruído temporal do gráfico Renko 10R (50 pontos no Mini-Índice B3) com a microestrutura de mercado do fluxo de ordens (Tape Reading tick-a-tick, Delta de Agressão e CVD).
O sistema envia ordens nativas para o MetaTrader 5 via ponte bidirecional WebSocket com suporte total a contas Hedge e Netting.

### 2. PRINCIPAIS REGRAS & ENGENHARIA QUANTITATIVA
- **Gráfico Renko 10R**: Tamanho de 50 pontos por tijolo. Inversão exige 100 pontos (2 boxes). Blocos sólidos e aproximação progressiva.
- **Painel de Fluxo Heikin-Ashi Tricolor**:
  - Verde (#10b981): Pressão compradora acelerando.
  - Vermelho (#ef4444): Pressão vendedora acelerando.
  - Cinza (#94a3b8): Reversão de fluxo, absorção ou indecisão.
- **Gatilho de Entrada no Pullback**: Ordem limite posicionada no reteste da abertura do box gerador do sinal.
- **Gestão de Risco**:
  - Stop Loss: 100 pontos (2 boxes).
  - Take Profit: 150 pontos (3 boxes).
  - Saída Parcial: 50 pontos (1 box a favor) com 1 contrato.
  - Breakeven Automático: Stop movido para Entrada + 5 pts (offset de taxas da B3) imediatamente na parcial.
  - Trailing Stop: Ativação a 60 pts com distância de 50 pts da máxima/mínima.
- **Livro de Auditoria Intraday**: Registro cronológico de todos os eventos com exportação CSV no padrão brasileiro (UTF-8 BOM, ponto e vírgula).
- **Ponte MetaTrader 5**: Script Python nativo (\`bot_mt5_convergencia_10r.py\`) ouvindo em ws://localhost:8765.

---
Relatório gerado automaticamente pelo Fluxo & Renko 10R MT5 Quant Terminal.`;

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DOSSIE_TECNICO_RENKO10R_${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-slate-950 border border-slate-800 rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-h-none print:w-full print:bg-white print:text-black">
        {/* Barra Superior de Ações (Oculta na Impressão) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-slate-900 border-b border-slate-800 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Resumo Executivo do Projeto & Relatório Técnico (PDF)
              </h2>
              <p className="text-[11px] text-slate-400">
                Documento consolidado pronto para visualização, impressão e exportação em PDF.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadMarkdown}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              title="Baixar arquivo Markdown do relatório técnico"
            >
              <Download className="w-3.5 h-3.5 text-neutral-400" />
              <span>Baixar .MD</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition-all shadow-sm cursor-pointer"
              title="Abrir diálogo de impressão do navegador ou Salvar como PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir / Salvar em PDF</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer ml-1"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Corpo do Documento Formatado para Visualização e Impressão */}
        <div
          ref={printAreaRef}
          className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 text-slate-200 text-xs sm:text-sm print:text-black print:bg-white print:overflow-visible print:p-0 print:space-y-4"
        >
          {/* CABEÇALHO DO RELATÓRIO */}
          <div className="border-b border-slate-800 pb-5 print:border-black/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold uppercase tracking-wider print:border print:border-emerald-700 print:text-emerald-800">
                  Documentação Técnica & Manual de Engenharia
                </span>
                <h1 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight mt-1 print:text-black">
                  Fluxo & Renko 10R MT5 Quant Terminal
                </h1>
                <p className="text-xs text-slate-400 print:text-gray-600">
                  Arquitetura de Alta Performance para Mini-Índice B3 (WIN$) e Execução Automatizada no MetaTrader 5
                </p>
              </div>

              <div className="text-right font-mono text-[11px] text-slate-400 shrink-0 print:text-gray-700">
                <div>Data: <strong className="text-slate-200 print:text-black">{new Date().toLocaleDateString('pt-BR')}</strong></div>
                <div>Versão: <strong className="text-slate-200 print:text-black">2.4.0 (Homologada B3)</strong></div>
                <div>Status EA: <strong className="text-emerald-400 print:text-emerald-800">Pronto para Produção</strong></div>
              </div>
            </div>
          </div>

          {/* PARÂMETROS ATUAIS HOMOLOGADOS */}
          <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-2 print:bg-gray-100 print:border-gray-300 print:text-black">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider print:text-black">
              Parâmetros Atuais do Setup ({config.profileName})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Ativo B3:</span>
                <strong className="text-slate-100 print:text-black">{config.symbol}</strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Tamanho Renko:</span>
                <strong className="text-emerald-400 print:text-emerald-800">{config.boxPoints} pts (10R)</strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Delta Mínimo:</span>
                <strong className="text-neutral-400 print:text-neutral-800">±{config.minDeltaThreshold} ctros</strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Gatilho de Entrada:</span>
                <strong className="text-amber-400 print:text-amber-800">
                  {config.entryTriggerType === 'PULLBACK_ENTRY' ? 'Reteste na Abertura' : 'A Mercado'}
                </strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Stop Loss:</span>
                <strong className="text-rose-400 print:text-rose-800">{config.stopLossPoints} pts (2 boxes)</strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Take Profit:</span>
                <strong className="text-emerald-400 print:text-emerald-800">{config.takeProfitPoints} pts (3 boxes)</strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Saída Parcial:</span>
                <strong className="text-neutral-400 print:text-neutral-800">
                  +{config.partialPoints} pts ({config.partialContracts} ctro)
                </strong>
              </div>
              <div className="p-2 bg-slate-950/70 rounded border border-slate-800/80 print:bg-white print:border-gray-300">
                <span className="text-[10px] text-slate-400 block print:text-gray-600">Breakeven + Offset:</span>
                <strong className="text-amber-300 print:text-amber-800">
                  {config.moveStopToBreakevenOnPartial ? `Ativo (+${config.breakevenOffsetPoints} pts)` : 'Inativo'}
                </strong>
              </div>
            </div>
          </div>

          {/* SEÇÃO 1: PROPÓSITO E VISÃO GERAL */}
          <div className="space-y-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-1 print:text-black print:border-black/20">
              <Activity className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              1. Visão Geral & Filosofia Quantitativa
            </h2>
            <p className="text-slate-300 leading-relaxed print:text-black">
              O terminal une a pureza do <strong>gráfico atemporal de Renko 10R</strong> com a análise profunda de <strong>Tape Reading tick-a-tick</strong>. Ao desconsiderar o tempo cronológico e reagir exclusivamente à oscilação de preço e ao saldo líquido de agressões (Delta e CVD), o operador elimina o ruído do mercado e entra alinhado com a liquidez institucional dos grandes players da B3.
            </p>
          </div>

          {/* SEÇÃO 2: GRÁFICO RENKO 10R E FLUXO HEIKIN-ASHI */}
          <div className="space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-1 print:text-black print:border-black/20">
              <Layers className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              2. Especificação Técnica: Renko 10R & Fluxo Heikin-Ashi
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg print:border-gray-300 print:bg-white">
                <h4 className="font-bold text-slate-200 mb-1 print:text-black">Tijolos Renko 10R (50 Pontos)</h4>
                <ul className="list-disc list-inside space-y-1 text-slate-400 print:text-gray-800 text-xs">
                  <li>Formação: 50 pontos no sentido do movimento anterior.</li>
                  <li>Reversão: Exige 100 pontos (2 boxes) no sentido contrário.</li>
                  <li>Corpo: 100% sólido preenchido sem miolo vazado.</li>
                  <li>Aproximação Temporal Progressiva: boxes recentes mais abertos, compactando-se ao envelhecer.</li>
                  <li>Escalas ajustáveis com zoom independente nos eixos X, Y e Fluxo.</li>
                </ul>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 p-3 rounded-lg print:border-gray-300 print:bg-white">
                <h4 className="font-bold text-slate-200 mb-1 print:text-black">Fluxo Heikin-Ashi Tricolor</h4>
                <ul className="list-disc list-inside space-y-1 text-slate-400 print:text-gray-800 text-xs">
                  <li><strong className="text-emerald-400 print:text-emerald-700">Verde (#10b981)</strong>: Subida de fluxo, compradores agredindo com aceleração contínua.</li>
                  <li><strong className="text-rose-400 print:text-rose-700">Vermelho (#ef4444)</strong>: Descida de fluxo, vendedores agredindo com aceleração contínua.</li>
                  <li><strong className="text-slate-400 print:text-gray-600">Cinza (#94a3b8)</strong>: Reversão de fluxo, absorção passiva ou esgotamento de força.</li>
                  <li>Fórmula: Suavização matemática das agressões intra-box acumuladas no CVD.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* SEÇÃO 3: REGRAS DE EXECUÇÃO E GESTÃO DE RISCO */}
          <div className="space-y-3">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-1 print:text-black print:border-black/20">
              <Shield className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              3. Regras de Execução & Gestão de Risco Institucional
            </h2>
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-lg space-y-2 print:border-gray-300 print:bg-white">
              <p className="text-slate-300 text-xs print:text-black">
                <strong>Gatilho de Reteste (Pullback na Abertura)</strong>: Quando um box confirma convergência com Delta forte, em vez de agredir a mercado no topo/fundo, o EA posiciona uma ordem limite no preço de abertura do box, buscando comprar ou vender em preço favorável sem pagar spread.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs font-mono print:border-gray-300">
                <div>
                  <span className="text-slate-400 block print:text-gray-600">Saída Parcial:</span>
                  <span className="text-neutral-400 font-bold print:text-neutral-800">+50 pts (R$ 10,00/ctro)</span>
                </div>
                <div>
                  <span className="text-slate-400 block print:text-gray-600">Breakeven Automático:</span>
                  <span className="text-amber-400 font-bold print:text-amber-800">Entrada + 5 pts de taxa</span>
                </div>
                <div>
                  <span className="text-slate-400 block print:text-gray-600">Trailing Stop Móvel:</span>
                  <span className="text-emerald-400 font-bold print:text-emerald-800">Ativa em +60p, segue a 50p</span>
                </div>
              </div>
            </div>
          </div>

          {/* SEÇÃO 4: LIVRO DE AUDITORIA INTRADAY */}
          <div className="space-y-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-1 print:text-black print:border-black/20">
              <Zap className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              4. Livro de Auditoria de Ordens Intraday (Padrão B3)
            </h2>
            <p className="text-slate-300 text-xs leading-relaxed print:text-black">
              O módulo de auditoria mantém uma trilha contínua e imutável de cada ordem disparada na sessão. Cada evento (envio, execução a mercado, reteste limite, saída parcial, stop loss, take profit e ajuste do trailing stop) é carimbado com data, hora, ticket e motivo. O livro pode ser exportado para planilha CSV no padrão brasileiro (delimitador ponto e vírgula e codificação UTF-8 com BOM).
            </p>
          </div>

          {/* SEÇÃO 5: INTEGRAÇÃO METATRADER 5 */}
          <div className="space-y-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-1 print:text-black print:border-black/20">
              <Terminal className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              5. Conexão MetaTrader 5 (Python Bridge WebSocket)
            </h2>
            <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-lg font-mono text-xs text-slate-300 space-y-1.5 print:border-gray-300 print:bg-white print:text-black">
              <div>Servidor WebSocket Local: <strong>ws://{config.mt5Host || 'localhost'}:{config.mt5Port || 8765}</strong></div>
              <div>Biblioteca Nativa: <strong>MetaTrader5 (Python 3.10+) + websockets</strong></div>
              <div>Comando de Inicialização: <span className="text-emerald-400 print:text-emerald-800">python bot_mt5_convergencia_10r.py</span></div>
              <div>Protocolo: JSON bidirecional com handshake AUTH (token compartilhado) antes de qualquer dado ou ordem, comando ARM/DISARM acompanhando o ligamento do robô e tetos de contratos por ordem e ordens por minuto impostos pela própria ponte.</div>
            </div>
          </div>

          {/* SEÇÃO 6: MAPA DE DIRETÓRIOS E ARQUITETURA DE ARQUIVOS */}
          <div className="space-y-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-1 print:text-black print:border-black/20">
              <Database className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              6. Estrutura Completa de Diretórios & Arquivos do Projeto
            </h2>
            <pre className="bg-slate-900 border border-slate-800 p-3 rounded-lg font-mono text-[10px] text-slate-300 overflow-x-auto print:bg-gray-50 print:border-gray-300 print:text-black">
{`├── src/
│   ├── types/
│   │   ├── trading.ts                # Modelos de RenkoBox, Tick, TradeOrder, Eventos de Auditoria e Config
│   │   └── auth.ts                   # Licenciamento SaaS, perfis de usuário e checkout
│   ├── services/
│   │   ├── renkoFlowEngine.ts        # Motor de formação atemporal 10R e cálculo do CVD
│   │   ├── eaConfigService.ts        # Persistência de configurações e perfis do operador
│   │   ├── orderAuditService.ts      # Livro de auditoria intraday e gerador de CSV brasileiro
│   │   ├── authService.ts            # Gestão de usuários, controle de dias restantes e Paywall
│   │   └── marketSimulator.ts        # Simulador realista de ticks B3 para testes sem MT5
│   ├── components/
│   │   ├── Header.tsx                # Barra superior com 3 zonas contratuais e status de conexão
│   │   ├── RenkoFlowChart.tsx        # Canvas de alta performance com Renko 10R, Fluxo Heikin-Ashi e Linhas de Ordens
│   │   ├── AutomationPanel.tsx       # Painel de parametrização do EA, perfis salvos e modais de confirmação
│   │   ├── IntradayOrderAudit.tsx    # Livro de auditoria com filtros, modal de timeline e exportação CSV
│   │   ├── EquityCurveView.tsx       # Curva de patrimônio acumulado trade-a-trade e drawdown
│   │   ├── OrdersAndStats.tsx        # Histórico de posições fechadas e métricas quantitativas
│   │   ├── TimesAndTrades.tsx        # Fita de negócios em tempo real e saldo de agressão
│   │   ├── PythonScriptView.tsx      # Visualizador e exportador do script Python bridge
│   │   ├── DocumentationView.tsx     # Guia passo a passo de instalação e teste de WebSocket
│   │   ├── AdminUsersModal.tsx       # Painel Master para gestão de licenças e concessão de dias
│   │   ├── SubscriptionPaywallModal.tsx # Checkout simulado com PIX e Cartão
│   │   └── ProjectDossierPdfModal.tsx# Resumo executivo formatado para impressão em PDF
│   ├── App.tsx                       # Orquestrador central, conexões e roteamento das abas
│   └── index.css                     # Configurações de Tailwind e estilos de impressão
├── bot_mt5_convergencia_10r.py       # Script Python autônomo para conexão com o MetaTrader 5
├── PROJECT_SUMMARY.md                # Documentação viva de continuidade técnica
└── PROJECT_CONSOLIDATION_CHAT_SEED.md# Prompt mestre para restauração imediata em novos bate-papos`}
            </pre>
          </div>

          {/* RODAPÉ DO DOCUMENTO */}
          <div className="pt-4 border-t border-slate-800 text-center text-[10px] text-slate-500 font-mono print:text-gray-500 print:border-black/20">
            Fluxo & Renko 10R MT5 Quant Terminal · Documento gerado em {new Date().toLocaleString('pt-BR')} · Uso Institucional & Educacional B3
          </div>
        </div>
      </div>
    </div>
  );
};
