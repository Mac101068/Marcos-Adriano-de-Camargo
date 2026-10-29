import React, { useState } from 'react';
import { AutomationConfig, MT5ConnectionState } from '../types/trading';
import {
  BookOpen,
  Terminal,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Download,
  Wifi,
  ShieldCheck,
  TrendingUp,
  Layers,
  ArrowRightLeft,
  Zap,
} from 'lucide-react';
import { generatePythonMT5Script } from '../utils/pythonScriptGenerator';

interface DocumentationViewProps {
  config: AutomationConfig;
  mt5State: MT5ConnectionState;
  onToggleMT5Connect: () => void;
  onOpenPdfModal?: () => void;
}

export const DocumentationView: React.FC<DocumentationViewProps> = ({
  config,
  mt5State,
  onToggleMT5Connect,
  onOpenPdfModal,
}) => {
  const [copiedPip, setCopiedPip] = useState<boolean>(false);
  const [copiedRun, setCopiedRun] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);

  const scriptContent = generatePythonMT5Script(config);

  const handleDownloadScript = () => {
    const blob = new Blob([scriptContent], { type: 'text/x-python;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'bot_mt5_convergencia_10r.py');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Testador de conexão local WebSocket
  const testWebSocketConnection = () => {
    setIsTesting(true);
    setTestResult(null);
    const wsUrl = `ws://${config.mt5Host || 'localhost'}:${config.mt5Port || 8765}`;

    try {
      const socket = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        socket.close();
        setIsTesting(false);
        setTestResult('TIMEOUT: O script Python não respondeu em 2.5s. Certifique-se de executá-lo no terminal.');
      }, 2500);

      socket.onopen = () => {
        clearTimeout(timeout);
        setIsTesting(false);
        setTestResult(`SUCCESS: Conexão com ${wsUrl} estabelecida com sucesso! O script Python está online.`);
        socket.close();
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        setIsTesting(false);
        setTestResult(`ERROR: Porta ${config.mt5Port} inacessível em ${wsUrl}. Inicie 'python bot_mt5_convergencia_10r.py' no seu PC.`);
      };
    } catch (e) {
      setIsTesting(false);
      setTestResult('ERROR: Falha ao inicializar WebSocket.');
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-6 overflow-y-auto space-y-8 max-w-6xl mx-auto">
      {/* Título Principal & Dossiê PDF */}
      <div className="border-b border-slate-800 pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 text-emerald-400 mb-1">
            <BookOpen className="w-5 h-5" />
            <span className="text-xs font-mono uppercase tracking-wider font-semibold">
              Manual de Engenharia e Integração
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-100">
            Guia Passo a Passo: Integração Terminal Web com MetaTrader 5
          </h1>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Instruções completas para conectar o MetaTrader 5 da B3 (ou Forex/CFDs) a este terminal web, extrair negócios tick a tick e executar ordens automáticas por convergência de fluxo.
          </p>
        </div>

        {onOpenPdfModal && (
          <button
            onClick={onOpenPdfModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shrink-0 cursor-pointer"
            title="Abrir o resumo completo do projeto em PDF"
          >
            <BookOpen className="w-4 h-4" />
            <span>Resumo do Projeto em PDF</span>
          </button>
        )}
      </div>

      {/* FERRAMENTA INTERATIVA: TESTADOR DE CONEXÃO LOCAL */}
      <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-neutral-400" />
              Diagnóstico de Conexão Local com o Script Python
            </span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Endereço configurado: <code className="text-emerald-400 font-mono">ws://{config.mt5Host || 'localhost'}:{config.mt5Port || 8765}</code>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={testWebSocketConnection}
              disabled={isTesting}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-neutral-600 hover:bg-neutral-500 disabled:opacity-50 text-white transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {isTesting ? (
                <>
                  <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Testando Porta...
                </>
              ) : (
                'Testar Conexão Agora'
              )}
            </button>

            <button
              onClick={handleDownloadScript}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar bot_mt5_convergencia_10r.py
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={`p-2.5 rounded text-xs font-mono border ${
              testResult.startsWith('SUCCESS')
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {testResult}
          </div>
        )}
      </div>

      {/* ARQUITETURA EM 3 CAMADAS */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-emerald-400" />
          1. Arquitetura da Solução
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 space-y-2">
            <div className="font-bold text-neutral-400">Camada 1: MetaTrader 5</div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Instalado no seu Windows, conectado à corretora (Clear, XP, BTG, Genial). É onde residem os dados reais de book, cotações e onde as ordens são efetivamente liquidadas.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900/50 border border-emerald-500/30 space-y-2">
            <div className="font-bold text-emerald-400">Camada 2: Script Python Bridge</div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Usa a biblioteca nativa <code className="text-slate-200">MetaTrader5</code> para capturar ticks do Times & Trades e abre uma porta WebSocket local (<code className="text-emerald-300">8765</code>) para alimentar o app.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 space-y-2">
            <div className="font-bold text-slate-200">Camada 3: Terminal Web 10R</div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Calcula os gráficos de Renko 10R (50 pts) e fluxo acumulado (CVD/Delta). Detecta convergências e envia ordens a mercado ou limitadas no reteste da abertura.
            </p>
          </div>
        </div>
      </div>

      {/* PASSO A PASSO DETALHADO */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          2. Passo a Passo de Instalação e Execução
        </h2>

        <div className="space-y-4 text-xs">
          {/* PASSO 1 */}
          <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
                1
              </span>
              Instalar o Python no Windows
            </div>
            <p className="text-slate-400 leading-relaxed pl-7">
              Se você ainda não tiver o Python instalado, baixe a versão estável mais recente (3.9 até 3.12) em{' '}
              <a
                href="https://www.python.org/downloads/"
                target="_blank"
                rel="noreferrer"
                className="text-neutral-400 hover:underline inline-flex items-center gap-1"
              >
                python.org <ExternalLink className="w-3 h-3" />
              </a>
              . <b>Atenção:</b> Durante a instalação, marque a caixinha <i>"Add Python to PATH"</i>.
            </p>
          </div>

          {/* PASSO 2 */}
          <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
                2
              </span>
              Instalar as Dependências no Prompt de Comando
            </div>
            <p className="text-slate-400 leading-relaxed pl-7">
              Abra o Prompt de Comando (CMD) ou PowerShell e digite o seguinte comando:
            </p>
            <div className="ml-7 flex items-center justify-between p-2.5 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-emerald-300">
              <code>pip install MetaTrader5 websockets</code>
              <button
                onClick={() => copyToClipboard('pip install MetaTrader5 websockets', setCopiedPip)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
              >
                {copiedPip ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedPip ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          {/* PASSO 3 */}
          <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
                3
              </span>
              Habilitar Negociação Automatizada no MetaTrader 5
            </div>
            <p className="text-slate-400 leading-relaxed pl-7">
              Abra o seu MetaTrader 5 e faça login na sua conta da corretora (Clear, XP, BTG, etc.). Em seguida:
            </p>
            <ul className="list-disc list-inside ml-9 space-y-1 text-slate-300 text-[11px]">
              <li>
                Acesse o menu: <b>Ferramentas → Opções</b> (ou aperte <kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded">Ctrl + O</kbd>).
              </li>
              <li>
                Clique na aba <b>"Expert Advisors"</b>.
              </li>
              <li>
                Marque a opção: <code className="text-emerald-300">✓ Permitir Negociação Automatizada</code>.
              </li>
              <li>
                Verifique se o botão <b>"Algo Trading"</b> na barra de ferramentas superior do MT5 está <span className="text-emerald-400 font-bold">VERDE</span> (ativado).
              </li>
            </ul>
          </div>

          {/* PASSO 4 */}
          <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
                4
              </span>
              Verificar o Ativo no Market Watch da B3
            </div>
            <p className="text-slate-400 leading-relaxed pl-7">
              No MetaTrader 5, o símbolo precisa estar visível na janela <b>Observação do Mercado</b> (<kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded">Ctrl + M</kbd>).
            </p>
            <div className="ml-7 p-2.5 bg-slate-950 rounded border border-slate-800 text-[11px] text-slate-300 space-y-1">
              <div>
                • Para <b>Mini-Índice Contínuo</b>: certifique-se de que <code className="text-emerald-300 font-bold">WIN$N</code> ou <code className="text-emerald-300 font-bold">WIN$</code> está adicionado.
              </div>
              <div>
                • Para o <b>Contrato Vigente</b>: adicione o código do vencimento atual (ex: <code className="text-neutral-300">WINZ24</code>, <code className="text-neutral-300">WING25</code>, etc.).
              </div>
              <div>
                • Pressione <kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded">Ctrl + U</kbd> no MT5, busque pelo ativo e clique em <b>"Exibir"</b> se ele não estiver visível.
              </div>
            </div>
          </div>

          {/* PASSO 5 */}
          <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-200">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
                5
              </span>
              Executar o Script Python
            </div>
            <p className="text-slate-400 leading-relaxed pl-7">
              Salve o arquivo baixado (<code className="text-slate-200">bot_mt5_convergencia_10r.py</code>) em uma pasta no seu computador. No terminal aberto nessa pasta, execute:
            </p>
            <div className="ml-7 flex items-center justify-between p-2.5 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-emerald-300">
              <code>python bot_mt5_convergencia_10r.py</code>
              <button
                onClick={() => copyToClipboard('python bot_mt5_convergencia_10r.py', setCopiedRun)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
              >
                {copiedRun ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedRun ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <p className="text-slate-400 leading-relaxed pl-7 text-[11px]">
              O terminal exibirá a mensagem de confirmação: <code className="text-slate-200">✅ Conectado ao MT5! Servidor WebSocket ativo em ws://localhost:8765</code>.
            </p>
          </div>

          {/* PASSO 6 */}
          <div className="p-4 rounded-lg bg-slate-900/40 border border-emerald-500/40 space-y-2">
            <div className="flex items-center gap-2 font-bold text-emerald-300">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
                6
              </span>
              Conectar o Terminal Web com 1 Clique
            </div>
            <p className="text-slate-300 leading-relaxed pl-7">
              Clique no botão <b>"Conectar MT5 Live"</b> no topo desta aplicação. O status passará para <span className="text-emerald-400 font-bold">MT5: CONECTADO</span>. A partir desse instante:
            </p>
            <ul className="list-disc list-inside ml-9 space-y-1 text-slate-300 text-[11px]">
              <li>Os ticks reais do Times & Trades da B3 alimentarão os gráficos atemporais na sua tela em tempo real.</li>
              <li>Toda convergência validada disparará ordens reais diretamente para sua corretora com Stop Loss e Take Profit.</li>
              <li>Você poderá clicar em <code className="text-emerald-400">▲ COMPRAR</code> ou <code className="text-rose-400">▼ VENDER</code> na boleta rápida para ordens manuais imediatas.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* DETALHAMENTO DAS REGRAS QUANTITATIVAS */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-400" />
          3. Entendendo a Estratégia de Convergência & Reteste
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="font-bold text-emerald-400 flex items-center gap-1.5">
              <Layers className="w-4 h-4" />
              Por que Renko 10R Atemporal (50 pontos)?
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Diferente de gráficos temporais (1 minuto, 5 minutos) que continuam desenhando velas mesmo sem volume, o gráfico de Renko é puramente <b>atemporal</b>: um box só fecha quando o mercado realmente desloca 50 pontos (10 ticks de 5 pontos no Mini-Índice). Isso elimina o ruído de mercado lateral e preserva seu capital.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="font-bold text-neutral-400 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              O que é a Convergência de Fluxo (Delta)?
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              O fluxo de agressão extraído tick a tick separa quem agrediu a compra (bateu no Ask) de quem agrediu a venda (bateu no Bid). O robô só dispara a compra se, além do box subir, o saldo líquido de contratos agredidos for fortemente comprador (<code className="text-slate-200">Delta ≥ +250 ctros</code>). Se o preço subir com delta negativo, o robô identifica como absorção passiva e não entra na armadilha.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="font-bold text-amber-400 flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4" />
              Entrada no Reteste (Pullback na Abertura)
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Ao invés de comprar no fechamento (topo esticado), o robô posiciona uma ordem limitada (<code className="text-slate-200">BUY LIMIT</code>) na abertura do box. A ordem só é executada se o preço recuar para testar o suporte. Se o preço andar 2 boxes sem voltar, a ordem pendente expira automaticamente.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="font-bold text-neutral-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              Contas Hedge vs Netting no MT5
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Em conta <b>Hedge</b>, cada ordem ganha um número de Ticket exclusivo, permitindo ter posições simultâneas de compra e venda com seus próprios Stops. O encerramento de posições no robô utiliza <code className="text-slate-200">position=ticket</code> para garantir que cada trade seja finalizado independentemente.
            </p>
          </div>
        </div>
      </div>

      {/* RESOLUÇÃO DE PROBLEMAS / FAQ */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          4. Diagnóstico de Dúvidas e Problemas Frequentes (FAQ)
        </h2>

        <div className="space-y-2.5 text-xs">
          <div className="p-3.5 rounded bg-slate-900/50 border border-slate-800 space-y-1">
            <span className="font-bold text-slate-200">
              Q: O script exibe "Falha ao conectar ao MetaTrader 5: (-10003)"
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              <b>Solução:</b> Isso ocorre quando o MetaTrader 5 não está aberto no computador ou se você possui mais de uma instalação. Abra o MT5 da sua corretora manualmente, faça login e rode o script novamente.
            </p>
          </div>

          <div className="p-3.5 rounded bg-slate-900/50 border border-slate-800 space-y-1">
            <span className="font-bold text-slate-200">
              Q: O que significa o erro "10030 (Unsupported filling mode)" no MT5?
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              <b>Solução:</b> Algumas corretoras na B3 só aceitam o tipo de preenchimento <code className="text-slate-300">RETURN</code>, enquanto outras exigem <code className="text-slate-300">IOC</code>. O nosso script já conta com detecção automática do filling mode da sua corretora via <code className="text-slate-300">symbol_info.filling_mode</code>.
            </p>
          </div>

          <div className="p-3.5 rounded bg-slate-900/50 border border-slate-800 space-y-1">
            <span className="font-bold text-slate-200">
              Q: Posso fechar o navegador e deixar o robô rodando direto no MT5?
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              <b>Sim!</b> O script Python possui toda a estratégia embutida de forma 100% autônoma. Ele lê os ticks, monta os blocos Renko 10R, avalia a convergência de fluxo e envia as ordens mesmo que o navegador esteja fechado.
            </p>
          </div>

          <div className="p-3.5 rounded bg-slate-900/50 border border-slate-800 space-y-1">
            <span className="font-bold text-slate-200">
              Q: Como testar primeiro sem arriscar dinheiro real?
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              <b>Recomendação:</b> Crie uma conta <b>DEMO (Simulador)</b> no MetaTrader 5 na sua corretora (Clear, XP, BTG) ou utilize a conta Demo da MetaQuotes. O robô funciona exatamente da mesma forma, permitindo validar a velocidade de execução sem risco de capital.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
