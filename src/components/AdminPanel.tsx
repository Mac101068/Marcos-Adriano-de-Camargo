import React, { useState } from 'react';
import { UserProfile, SubscriptionPlan, SubscriptionStatus, PaymentTransaction } from '../types/auth';
import { AuthService } from '../services/authService';
import {
  Users,
  DollarSign,
  Clock,
  UserPlus,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Calendar,
  Lock,
  Unlock,
  CreditCard,
  QrCode,
  ExternalLink,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

interface AdminPanelProps {
  currentUser: UserProfile;
  onUserListUpdated: () => void;
  onSelectUserToTest: (user: UserProfile) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUser,
  onUserListUpdated,
  onSelectUserToTest,
}) => {
  const [users, setUsers] = useState<UserProfile[]>(AuthService.getAllUsers());
  const [transactions, setTransactions] = useState<PaymentTransaction[]>(AuthService.getTransactions());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'users' | 'transactions' | 'settings'>('users');

  // Modal Novo Assinante
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPlan, setNewPlan] = useState<SubscriptionPlan>('MENSAL');
  const [newDays, setNewDays] = useState<number>(30);
  const [newNotes, setNewNotes] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const kpis = AuthService.getNetworkKPIs();

  const refreshData = () => {
    setUsers(AuthService.getAllUsers());
    setTransactions(AuthService.getTransactions());
    onUserListUpdated();
  };

  const handleExtendDays = (userId: string, days: number) => {
    try {
      AuthService.extendUserSubscription(userId, days);
      setFeedbackMsg(`+${days} dias adicionados com sucesso ao usuário!`);
      setTimeout(() => setFeedbackMsg(null), 3000);
      refreshData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao estender');
    }
  };

  const handleToggleStatus = (user: UserProfile) => {
    try {
      const nextStatus: SubscriptionStatus =
        user.status === 'SUSPENDED' || user.status === 'EXPIRED' ? 'ACTIVE' : 'SUSPENDED';
      AuthService.setUserStatus(user.id, nextStatus);
      setFeedbackMsg(`Status de ${user.name} alterado para ${nextStatus}!`);
      setTimeout(() => setFeedbackMsg(null), 3000);
      refreshData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro');
    }
  };

  const handleDeleteUser = (userId: string) => {
    if (confirm('Tem certeza de que deseja remover este usuário da rede?')) {
      try {
        AuthService.deleteUser(userId);
        refreshData();
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Erro ao excluir');
      }
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) {
      alert('Nome e E-mail são obrigatórios.');
      return;
    }
    try {
      AuthService.createUser({
        name: newName,
        email: newEmail,
        plan: newPlan,
        daysValid: Number(newDays),
        phone: newPhone,
        notes: newNotes,
      });
      setShowAddModal(false);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewNotes('');
      setFeedbackMsg('Novo assinante cadastrado com sucesso!');
      setTimeout(() => setFeedbackMsg(null), 3000);
      refreshData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao cadastrar');
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.phone && u.phone.includes(searchQuery));

    if (statusFilter === 'ALL') return matchesSearch;
    if (statusFilter === 'ACTIVE') return matchesSearch && u.status === 'ACTIVE';
    if (statusFilter === 'TRIAL') return matchesSearch && u.status === 'TRIAL';
    if (statusFilter === 'EXPIRED') return matchesSearch && (u.status === 'EXPIRED' || u.status === 'SUSPENDED');
    return matchesSearch;
  });

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-y-auto p-4 md:p-6 space-y-6">
      {/* Top Banner de Identificação */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
              PAINEL MASTER • REDE DE ASSINANTES
            </span>
            <span className="text-xs text-slate-500">Acesso Restrito: {currentUser.email}</span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-1">Gestão de Usuários & Assinaturas Mensais</h1>
          <p className="text-xs text-slate-400">
            Controle de licenças web atemporais, tempo de validade por usuário, renovações e faturamento recorrente.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-950/40 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            Novo Assinante
          </button>

          <button
            onClick={() => {
              AuthService.resetToDefault();
              refreshData();
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition-all"
            title="Restaura usuários de demonstração"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Resetar Demo
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 px-4 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Cards de Métricas e KPIs Financeiros */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Assinantes Ativos</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-extrabold text-white">{kpis.activeSubscribers}</span>
            <span className="text-xs text-slate-500 ml-1.5">de {kpis.totalUsers - 1} clientes</span>
          </div>
          <div className="mt-1 text-[11px] text-emerald-400 font-mono">
            {kpis.retentionRate}% taxa de retenção
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">MRR Estimado (Mensal)</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-extrabold text-emerald-400">
              R$ {kpis.estimatedMRR.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Receita Recorrente Mensal
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Vencendo em Breve</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-extrabold text-amber-400">{kpis.expiringIn7Days}</span>
            <span className="text-xs text-slate-500 ml-1.5">nos próx. 7 dias</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Oportunidade de renovação
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Expirados / Bloqueados</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2">
            <span className="text-2xl font-extrabold text-rose-400">{kpis.expiredUsers}</span>
            <span className="text-xs text-slate-500 ml-1.5">sem acesso web</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Aguardando pagamento
          </div>
        </div>
      </div>

      {/* Sub-Navegação: Lista de Usuários | Transações | Arquitetura SaaS */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'users'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Usuários & Licenças ({users.length})
        </button>

        <button
          onClick={() => setActiveTab('transactions')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'transactions'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Histórico Financeiro ({transactions.length})
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'settings'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Configuração de Vendas & Webhook
        </button>
      </div>

      {/* TAB 1: LISTA DE USUÁRIOS */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Barra de Filtros e Busca */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por nome, email ou telefone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded text-xs ${
                  statusFilter === 'ALL' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded text-xs ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Ativos
              </button>
              <button
                onClick={() => setStatusFilter('TRIAL')}
                className={`px-2.5 py-1 rounded text-xs ${
                  statusFilter === 'TRIAL'
                    ? 'bg-amber-950 text-amber-300 border border-amber-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Trial (Degustação)
              </button>
              <button
                onClick={() => setStatusFilter('EXPIRED')}
                className={`px-2.5 py-1 rounded text-xs ${
                  statusFilter === 'EXPIRED'
                    ? 'bg-rose-950 text-rose-300 border border-rose-500/40 font-semibold'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                Expirados
              </button>
            </div>
          </div>

          {/* Tabela de Assinantes */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-mono text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Assinante / E-mail</th>
                    <th className="py-3 px-4">Plano / Valor</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Validade / Dias Restantes</th>
                    <th className="py-3 px-4 text-center">Ações Rápidas</th>
                    <th className="py-3 px-4 text-right">Testar Visão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-sans">
                  {filteredUsers.map((user) => {
                    const remaining = AuthService.getRemainingDays(user.expiresAt);
                    const isActive = AuthService.isSubscriptionActive(user);

                    return (
                      <tr key={user.id} className="hover:bg-slate-800/40 transition-colors">
                        {/* Nome & Email */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                                user.role === 'ADMIN'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : isActive
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {user.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-white flex items-center gap-1.5">
                                {user.name}
                                {user.role === 'ADMIN' && (
                                  <span className="text-[10px] bg-purple-500/30 text-purple-200 px-1 py-0.2 rounded font-mono">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-400 font-mono text-[11px]">{user.email}</div>
                              {user.phone && <div className="text-slate-500 text-[10px]">{user.phone}</div>}
                            </div>
                          </div>
                        </td>

                        {/* Plano */}
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-200">{user.plan}</div>
                          <div className="text-slate-500 font-mono text-[11px]">
                            {user.monthlyFee > 0
                              ? `R$ ${user.monthlyFee.toFixed(2)}/mês`
                              : 'Isento / Vitalício'}
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3 px-4">
                          {user.role === 'ADMIN' ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
                              Vitalício
                            </span>
                          ) : user.status === 'TRIAL' ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                              Trial (Degustação)
                            </span>
                          ) : user.status === 'ACTIVE' && isActive ? (
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                              Ativo
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-rose-500/20 text-rose-300 border border-rose-500/30 font-medium">
                              {user.status === 'SUSPENDED' ? 'Bloqueado' : 'Expirado'}
                            </span>
                          )}
                        </td>

                        {/* Validade */}
                        <td className="py-3 px-4 font-mono">
                          {user.role === 'ADMIN' || user.plan === 'VITALICIO' ? (
                            <span className="text-slate-400">Acesso Permanente</span>
                          ) : (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`font-bold ${
                                    !isActive
                                      ? 'text-rose-400'
                                      : remaining <= 5
                                      ? 'text-amber-400'
                                      : 'text-emerald-400'
                                  }`}
                                >
                                  {!isActive ? '0 dias (Vencido)' : `${remaining} dias`}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500">
                                Expira: {new Date(user.expiresAt).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Ações Rápidas */}
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            {user.role !== 'ADMIN' && (
                              <>
                                <button
                                  onClick={() => handleExtendDays(user.id, 30)}
                                  className="px-2 py-1 rounded bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium"
                                  title="Adicionar +30 dias de acesso"
                                >
                                  +30d
                                </button>

                                <button
                                  onClick={() => handleExtendDays(user.id, 7)}
                                  className="px-2 py-1 rounded bg-amber-950/70 hover:bg-amber-900 border border-amber-500/30 text-amber-300 text-[11px] font-medium"
                                  title="Adicionar +7 dias de degustação"
                                >
                                  +7d
                                </button>

                                <button
                                  onClick={() => handleToggleStatus(user)}
                                  className={`p-1 rounded border text-[11px] ${
                                    user.status === 'SUSPENDED'
                                      ? 'bg-emerald-950 border-emerald-500/30 text-emerald-400'
                                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                                  }`}
                                  title={user.status === 'SUSPENDED' ? 'Desbloquear Acesso' : 'Bloquear Acesso'}
                                >
                                  {user.status === 'SUSPENDED' ? (
                                    <Unlock className="w-3.5 h-3.5" />
                                  ) : (
                                    <Lock className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                <button
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="p-1 rounded bg-slate-800 hover:bg-rose-950 hover:text-rose-400 text-slate-500 border border-slate-700"
                                  title="Remover Assinante"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Testar Visão (Switch Persona) */}
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => onSelectUserToTest(user)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-purple-900/60 hover:text-purple-200 border border-slate-700 text-slate-300 text-[11px] font-medium transition-colors inline-flex items-center gap-1"
                          >
                            <span>Ver Como</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HISTÓRICO FINANCEIRO */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider font-mono">
              Transações & Comprovantes de Renovação
            </h2>
            <span className="text-xs text-slate-500">
              Total Faturado no Período: R${' '}
              {transactions
                .reduce((acc, t) => acc + t.amount, 0)
                .toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Código / ID</th>
                  <th className="py-3 px-4">Cliente</th>
                  <th className="py-3 px-4">Forma</th>
                  <th className="py-3 px-4">Plano / Dias</th>
                  <th className="py-3 px-4">Valor</th>
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-sans">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono text-slate-300">{tx.transactionCode}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{tx.userName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{tx.userEmail}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="flex items-center gap-1.5 font-medium text-slate-300">
                        {tx.method === 'PIX' ? (
                          <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <CreditCard className="w-3.5 h-3.5 text-blue-400" />
                        )}
                        {tx.method}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium text-slate-200">{tx.plan}</span>
                      <span className="text-[10px] text-slate-500 ml-1">(+{tx.daysAdded} dias)</span>
                    </td>
                    <td className="py-3 px-4 font-bold text-emerald-400 font-mono">
                      R$ {tx.amount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                      {new Date(tx.date).toLocaleDateString('pt-BR')} às{' '}
                      {new Date(tx.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                        Aprovado
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CONFIGURAÇÃO DE VENDAS & WEBHOOK */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              Integração de Pagamentos Recorrentes
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              O fluxo de cobrança mensal automatizado conecta seu gateway de pagamento ao banco de dados da sua plataforma.
            </p>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="font-semibold text-emerald-400">1. Gateways Recomendados no Brasil</div>
                <div className="text-slate-400">
                  • <strong>Mercado Pago / Asaas</strong>: Melhor para PIX com aprovação instantânea em 2 segundos.
                  <br />• <strong>Stripe</strong>: Excelente para cartão de crédito recorrente internacional/nacional.
                  <br />• <strong>Kiwify / Hotmart</strong>: Ideal se você quiser usar checkout pronto de infoproduto.
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="font-semibold text-purple-400">2. Endpoint do Webhook de Liberação Automática</div>
                <div className="text-slate-400">
                  URL a configurar no seu gateway:
                </div>
                <div className="p-2 bg-slate-900 rounded font-mono text-[11px] text-slate-300 border border-slate-800 select-all">
                  https://seusite.com/api/webhooks/payment
                </div>
                <p className="text-[11px] text-slate-500">
                  Quando o cliente paga, o webhook recebe o evento <code>payment.approved</code>, localiza o e-mail do cliente e adiciona <code>+30 dias</code> ao campo <code>expiresAt</code>.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-400" />
              Segurança do Algoritmo & Acesso Web
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Como garantir que seus assinantes operem sem roubar seu código ou a lógica de convergência:
            </p>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Execução Server-Side</strong>: A estratégia de convergência entre fluxo atemporal e Renko roda no servidor; os assinantes recebem apenas a projeção visual e os sinais.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Anti-Compartilhamento de Senha</strong>: A verificação de <code>activeSessions</code> bloqueia logins simultâneos em dois navegadores ao mesmo tempo.
                </span>
              </div>

              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Bloqueio em Milissegundos</strong>: No instante em que a data de expiração é atingida, o Paywall fecha os dados e a renderização do fluxo.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CADASTRAR NOVO ASSINANTE */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                Cadastrar Novo Assinante
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome Completo do Trader</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Amanda Silva"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">E-mail de Acesso Web</label>
                <input
                  type="email"
                  required
                  placeholder="Ex: amanda.trader@gmail.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Plano Inicial</label>
                  <select
                    value={newPlan}
                    onChange={(e) => {
                      const p = e.target.value as SubscriptionPlan;
                      setNewPlan(p);
                      setNewDays(p === 'TRIMESTRAL' ? 90 : p === 'ANUAL' ? 365 : 30);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500"
                  >
                    <option value="MENSAL">Mensal B3 (30d)</option>
                    <option value="TRIMESTRAL">Trimestral (90d)</option>
                    <option value="ANUAL">Anual VIP (365d)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Dias de Acesso</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={newDays}
                    onChange={(e) => setNewDays(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">WhatsApp / Telefone (Opcional)</label>
                <input
                  type="text"
                  placeholder="(11) 99999-8888"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Observações Internas (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Veio indicado do grupo VIP de scalping"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                >
                  Salvar e Liberar Acesso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
