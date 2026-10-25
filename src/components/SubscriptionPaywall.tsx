import React, { useState } from 'react';
import { UserProfile, SubscriptionPlan } from '../types/auth';
import { AuthService } from '../services/authService';
import {
  Lock,
  Sparkles,
  CheckCircle2,
  QrCode,
  CreditCard,
  ArrowRight,
  ShieldAlert,
  Clock,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';

interface SubscriptionPaywallProps {
  user: UserProfile;
  onRenewSuccess: (updatedUser: UserProfile) => void;
  onSwitchUser: () => void;
}

export const SubscriptionPaywall: React.FC<SubscriptionPaywallProps> = ({
  user,
  onRenewSuccess,
  onSwitchUser,
}) => {
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>('MENSAL');
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedPix, setCopiedPix] = useState(false);

  const plans = [
    {
      id: 'MENSAL' as SubscriptionPlan,
      name: 'Mensal B3 Pro',
      price: 'R$ 149,00',
      period: 'por mês',
      days: 30,
      badge: 'Mais Popular',
      features: [
        'Acesso Web ilimitado em tempo real',
        'Gráfico Atemporal Renko 10R (50 pts)',
        'Fluxo de Agressão & Times and Trades',
        'CVD e Alertas de Convergência',
        'Envio de Ordens via Bridge MT5',
      ],
    },
    {
      id: 'TRIMESTRAL' as SubscriptionPlan,
      name: 'Trimestral B3 Pro',
      price: 'R$ 380,00',
      period: 'por trimestre (R$ 126/mês)',
      days: 90,
      badge: 'Economize 15%',
      features: [
        'Todos os recursos do plano mensal',
        'Prioridade na fila de suporte',
        '90 dias ininterruptos de acesso web',
        'Templates de parâmetros calibrados',
      ],
    },
    {
      id: 'ANUAL' as SubscriptionPlan,
      name: 'Anual VIP',
      price: 'R$ 1.188,00',
      period: 'por ano (R$ 99/mês)',
      days: 365,
      badge: 'Melhor Custo-Benefício',
      features: [
        'Acesso garantido por 1 ano completo',
        'Economia de mais de R$ 600 no ano',
        'Acesso a todas as futuras atualizações',
        'Canal VIP direto com a equipe quant',
      ],
    },
  ];

  const currentPlanObj = plans.find((p) => p.id === selectedPlan) || plans[0];

  const handleSimulatePayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      try {
        const { user: updatedUser } = AuthService.processPayment(user.id, selectedPlan, paymentMethod);
        setIsProcessing(false);
        onRenewSuccess(updatedUser);
      } catch (err) {
        setIsProcessing(false);
        alert(err instanceof Error ? err.message : 'Erro ao processar pagamento');
      }
    }, 1200);
  };

  const fakePixCode = `00020126580014BR.GOV.BCB.PIX0136b3quant-terminal-licenca-${user.id}520400005303986540${currentPlanObj.price.replace(
    /[^0-9]/g,
    ''
  )}5802BR5920MARCOS CAMARGO QUANT6009SAO PAULO62070503***6304`;

  const copyPix = () => {
    navigator.clipboard?.writeText(fakePixCode);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 2500);
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 md:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Banner Superior com Alerta de Acesso Expirado */}
        <div className="bg-gradient-to-r from-rose-950/80 via-slate-900 to-amber-950/60 p-6 border-b border-rose-500/20">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0 shadow-inner">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    ACESSO WEB SUSPENSO
                  </span>
                  <span className="text-xs text-slate-400">Usuário: {user.email}</span>
                </div>
                <h1 className="text-xl md:text-2xl font-bold text-white mt-1">
                  Seu Período de Assinatura Encerrou
                </h1>
                <p className="text-sm text-slate-300 mt-0.5">
                  Para continuar acompanhando o fluxo atemporal, Renko 10R e o disparo de ordens automáticas,
                  renove sua mensalidade abaixo.
                </p>
              </div>
            </div>

            <button
              onClick={onSwitchUser}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 shrink-0 self-start md:self-center transition-colors"
            >
              Trocar de Usuário / Modo Admin
            </button>
          </div>
        </div>

        {/* Corpo: Seleção de Planos */}
        <div className="p-6 md:p-8 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
              1. Escolha o Período de Acesso Web
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map((p) => {
                const isSelected = selectedPlan === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPlan(p.id)}
                    className={`cursor-pointer rounded-xl p-5 border relative transition-all ${
                      isSelected
                        ? 'bg-slate-800/90 border-emerald-500 ring-2 ring-emerald-500/20 shadow-lg shadow-emerald-950/30'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                    }`}
                  >
                    {p.badge && (
                      <span
                        className={`absolute -top-2.5 right-4 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isSelected
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-700 text-slate-200'
                        }`}
                      >
                        {p.badge}
                      </span>
                    )}

                    <h3 className="text-base font-bold text-white">{p.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold text-white">{p.price}</span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{p.period}</span>

                    <div className="mt-4 pt-3 border-t border-slate-800 space-y-2">
                      {p.features.map((feat, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{feat}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 pt-2">
                      <span className="text-[11px] font-mono text-emerald-400/90 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Libera +{p.days} dias de uso imediato
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Forma de Pagamento & Simulação */}
          <div className="pt-4 border-t border-slate-800">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
              2. Forma de Pagamento & Liberação
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Opções de Pagamento */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setPaymentMethod('PIX')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                      paymentMethod === 'PIX'
                        ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/20'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    PIX Instantâneo
                  </button>

                  <button
                    onClick={() => setPaymentMethod('CREDIT_CARD')}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-semibold transition-all ${
                      paymentMethod === 'CREDIT_CARD'
                        ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/20'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    Cartão de Crédito
                  </button>
                </div>

                {paymentMethod === 'PIX' ? (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span className="font-medium text-emerald-400 flex items-center gap-1.5">
                        <QrCode className="w-4 h-4" /> Chave PIX Copia & Cola:
                      </span>
                      <span className="text-[11px] text-slate-500">Aprovação em segundos</span>
                    </div>

                    <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <input
                        readOnly
                        value={fakePixCode}
                        className="bg-transparent text-[10px] font-mono text-slate-400 w-full outline-none truncate"
                      />
                      <button
                        onClick={copyPix}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 shrink-0 flex items-center gap-1"
                      >
                        {copiedPix ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedPix ? 'Copiado!' : 'Copiar'}
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400">
                      No sistema em produção com Webhook, a confirmação pelo banco libera sua conta automaticamente sem intervenção humana.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="text-xs text-slate-300 flex items-center gap-1.5 font-medium">
                      <CreditCard className="w-4 h-4 text-emerald-400" />
                      Assinatura Recorrente Mensal
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <input
                        disabled
                        value="•••• •••• •••• 4242"
                        className="bg-slate-900 border border-slate-800 p-2 rounded-lg text-slate-400 font-mono text-xs"
                      />
                      <input
                        disabled
                        value="Validade: 12/28"
                        className="bg-slate-900 border border-slate-800 p-2 rounded-lg text-slate-400 font-mono text-xs"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Cobrança automática a cada {currentPlanObj.days} dias via Stripe ou Mercado Pago. Cancele quando quiser.
                    </p>
                  </div>
                )}
              </div>

              {/* Botão de Ação & Resumo */}
              <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Plano selecionado:</span>
                    <span className="font-semibold text-white">{currentPlanObj.name}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Tempo de Acesso:</span>
                    <span className="font-mono text-emerald-400 font-semibold">+{currentPlanObj.days} dias</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Valor a pagar:</span>
                    <span className="text-lg font-bold text-white">{currentPlanObj.price}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
                    <span>Email associado:</span>
                    <span className="text-slate-300 font-mono text-[11px]">{user.email}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 space-y-2">
                  <button
                    onClick={handleSimulatePayment}
                    disabled={isProcessing}
                    className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Confirmando Pagamento e Liberando...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Simular Pagamento e Liberar Acesso Agora</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-center text-slate-500">
                    Protótipo interativo: ao clicar, o sistema simula o webhook do banco e libera a conta imediatamente.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé Informativo */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
            <span>Terminal Exclusivo Web • Proteção contra múltiplos acessos simultâneos</span>
          </div>
          <div>Dúvidas ou Suporte? Contate o administrador Marcos Camargo</div>
        </div>
      </div>
    </div>
  );
};
