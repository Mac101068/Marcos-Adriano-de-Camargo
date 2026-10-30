import React, { useState } from 'react';
import { AutomationConfig } from '../types/trading';
import { generatePythonMT5Script } from '../utils/pythonScriptGenerator';
import { Download, Copy, Check, Terminal, BookOpen, AlertTriangle, ShieldCheck, Cpu, ArrowRightLeft, CheckCircle2 } from 'lucide-react';

interface PythonScriptViewProps {
  config: AutomationConfig;
}

export const PythonScriptView: React.FC<PythonScriptViewProps> = ({ config }) => {
  const [copied, setCopied] = useState<boolean>(false);
  const scriptContent = generatePythonMT5Script(config);

  const handleCopy = () => {
    navigator.clipboard.writeText(scriptContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownload = () => {
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

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800/80 rounded-lg p-5 overflow-y-auto space-y-6">
      {/* Top Banner com Ações */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-slate-100">
              Conexão com MetaTrader 5 & Código Python Oficial
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Sim! Este terminal conecta-se ao MetaTrader 5 via WebSocket (<code className="text-emerald-400 font-mono">ws://IP-DO-WINDOWS:{config.mt5Port}</code>) ou opera 100% autônomo em segundo plano.
          </p>
          <p className="text-[11px] text-sky-400/90 mt-1 font-sans">
            💡 O script roda no <b>Windows</b> (onde o MT5/XP B3 está instalado — a biblioteca Python do MT5 não existe para Mac). Este navegador, em qualquer máquina da mesma rede Wi-Fi, conecta apontando <b>Ajustes → MT5 Host</b> para o IP do Windows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar Script
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar Script .py Pronto
          </button>
        </div>
      </div>

      {/* ARQUITETURA DA CONEXÃO MT5 */}
      <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
          Como Funciona a Conexão com o MetaTrader 5 e Envio de Ordens
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-3 bg-slate-950 rounded border border-slate-800/80 space-y-1.5">
            <div className="text-neutral-400 font-bold flex items-center gap-1.5">
              <span>1. Terminal Web (Navegador)</span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              Exibe os gráficos atemporais de Renko 10R e Fluxo (Delta/CVD), permite disparar ordens manuais e monitorar os disparos automáticos.
            </p>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-emerald-500/30 space-y-1.5">
            <div className="text-emerald-400 font-bold flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span>2. Script Python (Bridge & Robô)</span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              Roda no WINDOWS junto com o MT5 da XP. Abre o servidor na porta <code className="text-emerald-300">{config.mt5Port}</code> para TODA a rede local (0.0.0.0), transmitindo ticks e executando ordens para qualquer navegador da rede.
            </p>
          </div>

          <div className="p-3 bg-slate-950 rounded border border-slate-800/80 space-y-1.5">
            <div className="text-slate-200 font-bold flex items-center gap-1.5">
              <span>3. MetaTrader 5 (B3 Desktop)</span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
              Recebe os comandos <code className="text-slate-300">mt5.order_send()</code> com Stop Loss ({config.stopLossPoints} pts) e Take Profit ({config.takeProfitPoints} pts) na sua corretora.
            </p>
          </div>
        </div>
      </div>

      {/* Tutorial Passo a Passo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
              1
            </span>
            Instalar Dependências no Windows
          </div>
          <p className="text-[12px] text-slate-400">
            Abra seu prompt de comando / PowerShell e instale a biblioteca do MT5 e websockets:
          </p>
          <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-emerald-300 select-all">
            pip install MetaTrader5 websockets
          </div>
        </div>

        <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
              2
            </span>
            Habilitar Algo Trading no MT5
          </div>
          <p className="text-[12px] text-slate-400">
            No MT5: menu <b>Ferramentas → Opções → Expert Advisors</b>. Marque a opção:
          </p>
          <div className="text-[11px] text-slate-300 font-mono bg-slate-950 p-2 rounded border border-slate-800">
            ✓ Permitir Negociação Automatizada
          </div>
        </div>

        <div className="bg-slate-900/70 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-mono">
              3
            </span>
            Rodar o Script e Clicar em Conectar
          </div>
          <p className="text-[12px] text-slate-400">
            Execute o script baixado e clique no botão <b>"Conectar MT5 Live"</b> no topo da tela:
          </p>
          <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-emerald-300 select-all">
            python bot_mt5_convergencia_10r.py
          </div>
        </div>
      </div>

      {/* Destaque Técnico sobre a Extração de Fluxo e Detecção de Convergência */}
      <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <BookOpen className="w-4 h-4 text-neutral-400" />
          Como o Script Executa e Envia as Ordens
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="space-y-1.5">
            <span className="font-semibold text-emerald-400">1. Extração do Times & Trades Tick a Tick:</span>
            <p className="text-slate-400 leading-relaxed">
              O script captura cada negócio real executado na B3 usando <code className="text-slate-200 font-mono">mt5.copy_ticks_from(..., mt5.COPY_TICKS_TRADE)</code>. As flags binárias <code className="text-slate-200 font-mono">TICK_FLAG_BUY</code> e <code className="text-slate-200 font-mono">TICK_FLAG_SELL</code> identificam exatamente se a agressão foi de compra ou de venda.
            </p>
          </div>
          <div className="space-y-1.5">
            <span className="font-semibold text-neutral-400">2. Disparo e Envio de Ordens Automáticas:</span>
            <p className="text-slate-400 leading-relaxed">
              O preço 10R é calculado atemporalmente em caixas de {config.boxPoints} pontos. Ao detectar convergência (Delta <code className="text-slate-200 font-mono">≥ ±{config.minDeltaThreshold}</code>), o script chama <code className="text-slate-200 font-mono">mt5.order_send()</code> a mercado com Stop Loss de {config.stopLossPoints} pts e Take Profit de {config.takeProfitPoints} pts diretamente na sua conta da corretora.
              {config.adaptiveThresholdEnabled ? (
                <>
                  {' '}Com o <b className="text-emerald-300">Limiar Adaptativo de Regime</b> ligado, o ±{config.minDeltaThreshold} vira ponto de partida: o script embute um <code className="text-slate-200 font-mono">RegimeMeter</code> (volume dos últimos {config.regimeLookbackBoxes ?? 20} boxes ÷ média do dia, 0,5x–3x) e exige Delta acima de <code className="text-slate-200 font-mono">±{config.minDeltaThreshold} × fator</code> — horas quentes exigem agressão proporcional, horas frias liberam sinais antes travados.
                </>
              ) : (
                <> Limiar adaptativo DESLIGADO nos Ajustes: o script usa o Delta Mínimo fixo para todo o pregão.</>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Caixa do Código Fonte com Realce de Sintaxe */}
      <div className="bg-slate-900 rounded-lg border border-slate-800 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            <span>bot_mt5_convergencia_10r.py</span>
          </div>
          <span className="text-[11px] text-slate-500">Python 3.9+ · MetaTrader5 API & WebSockets</span>
        </div>

        <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed bg-[#050811] max-h-[550px] select-all">
          <code>{scriptContent}</code>
        </pre>
      </div>

      {/* Aviso de Gestão de Risco */}
      <div className="flex items-start gap-3 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
        <div className="space-y-1">
          <span className="font-bold">Dica de Segurança Operacional:</span>
          <p className="text-amber-200/80 leading-relaxed">
            Sempre inicie testando em uma conta <b>DEMO</b> no MetaTrader 5 para certificar-se da velocidade de execução da sua corretora e do comportamento dos lotes configurados antes de operar com capital real na B3.
          </p>
        </div>
      </div>
    </div>
  );
};
