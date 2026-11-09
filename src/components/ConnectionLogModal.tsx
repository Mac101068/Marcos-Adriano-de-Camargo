import React, { useState, useMemo } from 'react';
import {
  Activity,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Copy,
  Trash2,
  RefreshCw,
  Cpu,
  Server,
  Zap,
} from 'lucide-react';

export interface ConnectionLogEntry {
  id: string;
  timestamp: number;
  timeStr: string;
  type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  category: 'WEBSOCKET' | 'MT5_TERMINAL' | 'PING_LATENCY' | 'RECONNECT';
  message: string;
  details?: string;
  code?: number;
  reason?: string;
  latencyMs?: number;
}

interface ConnectionLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: ConnectionLogEntry[];
  onClearLogs: () => void;
  connectionStatus: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR';
  currentLatency: number | null;
  disconnectCount: number;
  sessionUptimeSeconds: number;
  wsUrl: string;
  brokerCompany?: string;
  accountLogin?: string;
  terminalConnected?: boolean;
}

export const ConnectionLogModal: React.FC<ConnectionLogModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  connectionStatus,
  currentLatency,
  disconnectCount,
  sessionUptimeSeconds,
  wsUrl,
  brokerCompany,
  accountLogin,
  terminalConnected = true,
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'ERRORS_ONLY'>('ALL');
  const [copied, setCopied] = useState<boolean>(false);

  // Formata o tempo de uptime
  const formattedUptime = useMemo(() => {
    const hours = Math.floor(sessionUptimeSeconds / 3600);
    const minutes = Math.floor((sessionUptimeSeconds % 3600) / 60);
    const seconds = sessionUptimeSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }, [sessionUptimeSeconds]);

  // Diagnóstico Inteligente baseado nas estatísticas
  const diagnosticSummary = useMemo(() => {
    if (disconnectCount === 0 && connectionStatus === 'CONNECTED') {
      return {
        severity: 'EXCELLENT',
        title: 'Conexão Estável & Saudável',
        description: 'Nenhuma queda registrada nesta sessão. O WebSocket local e a ponte MT5 estão respondendo perfeitamente.',
      };
    }

    if (!terminalConnected && connectionStatus === 'CONNECTED') {
      return {
        severity: 'INTERNET_OR_BROKER',
        title: 'Terminal MT5 sem sinal com a XP',
        description: 'A ponte local está ativa, mas o MetaTrader 5 perdeu a comunicação com os servidores da corretora XP. Causa provável: oscilação na sua conexão com a internet ou manutenção da XP.',
      };
    }

    const has1006 = logs.some((l) => l.code === 1006);
    if (has1006) {
      return {
        severity: 'ABNORMAL_CLOSURE',
        title: 'Quedas por Fechamento Anormal (Código 1006)',
        description: 'O socket fechou sem handshake de encerramento. Causas prováveis: o processo "ponte_mt5.py" foi reiniciado, a máquina entrou em suspensão temporária, ou o antivírus/firewall encerrou a conexão TCP.',
      };
    }

    if (currentLatency !== null && currentLatency > 150) {
      return {
        severity: 'HIGH_LATENCY',
        title: 'Latência Local Elevada (> 150ms)',
        description: 'Como a ponte roda no próprio PC (localhost), uma latência acima de 50ms indica alto uso de CPU/processamento na sua máquina ou concorrência excessiva de tarefas.',
      };
    }

    if (disconnectCount > 0) {
      return {
        severity: 'WARNING',
        title: `Atenção: ${disconnectCount} queda(s) registrada(s)`,
        description: 'A conexão sofreu interrupções. Verifique abaixo os códigos de erro e timestamps exatos de cada evento.',
      };
    }

    return {
      severity: 'NEUTRAL',
      title: 'Aguardando Dados de Diagnóstico',
      description: 'O monitor de conexão está coletando estatísticas e batimentos de pulso em tempo real.',
    };
  }, [disconnectCount, connectionStatus, terminalConnected, logs, currentLatency]);

  // Filtra logs
  const filteredLogs = useMemo(() => {
    if (filterType === 'ERRORS_ONLY') {
      return logs.filter((l) => l.type === 'ERROR' || l.type === 'WARN' || l.code !== undefined);
    }
    return logs;
  }, [logs, filterType]);

  // Copia relatório completo para clipboard
  const handleCopyReport = () => {
    const lines = [
      `=== RELATÓRIO DE DIAGNÓSTICO DE CONEXÃO MT5 ===`,
      `Data/Hora: ${new Date().toLocaleString('pt-BR')}`,
      `Status Atual: ${connectionStatus}`,
      `URL da Ponte: ${wsUrl}`,
      `Corretora / Conta: ${brokerCompany || 'XP'} #${accountLogin || '50534540'}`,
      `Terminal MT5 Conectado à XP: ${terminalConnected ? 'SIM' : 'NÃO (SEM SINAL)'}`,
      `Quedas Registradas: ${disconnectCount}`,
      `Uptime da Sessão: ${formattedUptime}`,
      `Latência Atual (RTT): ${currentLatency !== null ? `${currentLatency}ms` : 'N/A'}`,
      `Diagnóstico do Sistema: ${diagnosticSummary.title} - ${diagnosticSummary.description}`,
      ``,
      `--- HISTÓRICO DE EVENTOS RECENTES (${logs.length} eventos) ---`,
      ...logs.map((l) => `[${l.timeStr}] [${l.type}] [${l.category}] ${l.message}${l.code ? ` (Code: ${l.code})` : ''}${l.reason ? ` - ${l.reason}` : ''}`),
    ];

    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              connectionStatus === 'CONNECTED'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
            }`}>
              {connectionStatus === 'CONNECTED' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Diagnóstico & Log de Conexão</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  connectionStatus === 'CONNECTED'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : 'bg-rose-950 text-rose-400 border border-rose-800'
                }`}>
                  {connectionStatus}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Auditoria de socket, detecção de quedas e verificação de saúde entre Navegador, Ponte e MT5
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 4 Cards de Métricas de Conexão */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-4 bg-slate-950/50 border-b border-slate-800">
          {/* Card 1: Quedas de Conexão */}
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Quedas Registradas</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-base font-bold font-mono ${disconnectCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {disconnectCount}
              </span>
              <span className="text-[10px] text-slate-500">queda(s)</span>
            </div>
          </div>

          {/* Card 2: Latência RTT */}
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Latência RTT (Ping)</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-base font-bold font-mono ${
                currentLatency === null
                  ? 'text-slate-500'
                  : currentLatency <= 5
                  ? 'text-emerald-400'
                  : currentLatency <= 30
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}>
                {currentLatency !== null ? `${currentLatency} ms` : 'Aferindo...'}
              </span>
              <span className="text-[10px] text-slate-500">
                {currentLatency !== null && currentLatency <= 5 ? '(Excelente)' : ''}
              </span>
            </div>
          </div>

          {/* Card 3: Uptime da Conexão */}
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Tempo Conectado</span>
            <div className="text-base font-bold font-mono text-slate-200 mt-0.5">
              {formattedUptime}
            </div>
          </div>

          {/* Card 4: Terminal MT5 / XP */}
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Sinal MT5 ↔ XP</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${terminalConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              <span className={`text-xs font-bold font-mono ${terminalConnected ? 'text-emerald-300' : 'text-rose-400'}`}>
                {terminalConnected ? 'ONLINE' : 'SEM SINAL (XP)'}
              </span>
            </div>
          </div>
        </div>

        {/* Caixa de Diagnóstico Inteligente */}
        <div className="px-4 py-3 bg-slate-900/40 border-b border-slate-800">
          <div className={`p-3 rounded-xl border flex items-start gap-3 ${
            diagnosticSummary.severity === 'EXCELLENT'
              ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
              : diagnosticSummary.severity === 'INTERNET_OR_BROKER' || diagnosticSummary.severity === 'ABNORMAL_CLOSURE'
              ? 'bg-rose-950/30 border-rose-800/60 text-rose-300'
              : 'bg-amber-950/30 border-amber-800/60 text-amber-300'
          }`}>
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide">
                {diagnosticSummary.title}
              </h4>
              <p className="text-[11px] mt-0.5 text-slate-300">
                {diagnosticSummary.description}
              </p>
            </div>
          </div>
        </div>

        {/* Barra de Ações da Tabela de Logs */}
        <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                filterType === 'ALL' ? 'bg-slate-800 text-slate-100 shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos os Eventos ({logs.length})
            </button>
            <button
              onClick={() => setFilterType('ERRORS_ONLY')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                filterType === 'ERRORS_ONLY' ? 'bg-rose-950 text-rose-300 border border-rose-800/50 shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Apenas Quedas & Alertas
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyReport}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Copiar relatório completo com diagnóstico"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copiado!' : 'Copiar Diagnóstico'}</span>
            </button>

            <button
              onClick={onClearLogs}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
              title="Limpar logs registrados nesta sessão"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          </div>
        </div>

        {/* Tabela de Eventos Cronológicos */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs max-h-[380px]">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-10 text-slate-500 font-sans">
              Nenhum evento registrado com o filtro atual.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className={`p-2 rounded-lg border flex items-start justify-between gap-3 ${
                  log.type === 'ERROR'
                    ? 'bg-rose-950/20 border-rose-800/50 text-rose-300'
                    : log.type === 'WARN'
                    ? 'bg-amber-950/20 border-amber-800/50 text-amber-300'
                    : log.type === 'SUCCESS'
                    ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <span className="text-[10px] text-slate-500 flex-shrink-0 pt-0.5">
                    {log.timeStr}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-200 break-words">
                      {log.message}
                    </div>
                    {log.details && (
                      <div className="text-[11px] text-slate-400 mt-0.5 break-words">
                        {log.details}
                      </div>
                    )}
                    {log.code !== undefined && (
                      <div className="text-[10px] text-rose-400 mt-0.5">
                        Código de Encerramento: <strong>{log.code}</strong> {log.reason ? `(${log.reason})` : ''}
                      </div>
                    )}
                  </div>
                </div>

                {log.latencyMs !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 flex-shrink-0">
                    {log.latencyMs} ms
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Rodapé informativo */}
        <div className="px-5 py-2.5 bg-slate-950 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <span>Servidor WebSocket: {wsUrl}</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
