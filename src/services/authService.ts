import { UserProfile, PaymentTransaction, NetworkSummaryKPIs, SubscriptionPlan, SubscriptionStatus } from '../types/auth';

const STORAGE_KEY_USERS = 'quant_terminal_users_v2';
const STORAGE_KEY_CURRENT = 'quant_terminal_current_user_v2';
const STORAGE_KEY_TRANSACTIONS = 'quant_terminal_transactions_v2';

const now = new Date();

// Helper to create date offset in days
const addDays = (baseDate: Date, days: number): string => {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const DEFAULT_USERS: UserProfile[] = [
  {
    id: 'user-admin-1',
    name: 'Marcos Camargo (Admin Master)',
    email: 'marcos.a.camargo@gmail.com',
    role: 'ADMIN',
    plan: 'VITALICIO',
    status: 'ACTIVE',
    monthlyFee: 0,
    createdAt: addDays(now, -90),
    expiresAt: addDays(now, 3650), // 10 anos
    lastLogin: new Date().toISOString(),
    activeSessions: 1,
    phone: '(11) 98765-4321',
    notes: 'Criador e proprietário da rede de terminais quantitativos.',
  },
  {
    id: 'user-sub-1',
    name: 'Rodrigo B3 Scalper',
    email: 'rodrigo.trader@gmail.com',
    role: 'SUBSCRIBER',
    plan: 'MENSAL',
    status: 'ACTIVE',
    monthlyFee: 149.0,
    createdAt: addDays(now, -40),
    expiresAt: addDays(now, 22), // 22 dias restantes
    lastLogin: addDays(now, 0),
    activeSessions: 1,
    phone: '(11) 99123-5566',
    notes: 'Assinante adimplente via PIX recorrente mensal.',
  },
  {
    id: 'user-sub-2',
    name: 'Juliana Castro (Trial 7d)',
    email: 'juliana.invest@outlook.com',
    role: 'SUBSCRIBER',
    plan: 'MENSAL',
    status: 'TRIAL',
    monthlyFee: 149.0,
    createdAt: addDays(now, -4),
    expiresAt: addDays(now, 3), // 3 dias restantes de degustação
    lastLogin: addDays(now, -1),
    activeSessions: 1,
    phone: '(21) 98844-1234',
    notes: 'Período gratuito de degustação do fluxo 10R.',
  },
  {
    id: 'user-sub-3',
    name: 'Lucas Ferreira (Expirado)',
    email: 'lucas.scalper@uol.com.br',
    role: 'SUBSCRIBER',
    plan: 'MENSAL',
    status: 'EXPIRED',
    monthlyFee: 149.0,
    createdAt: addDays(now, -65),
    expiresAt: addDays(now, -2), // Venceu há 2 dias
    lastLogin: addDays(now, -2),
    activeSessions: 0,
    phone: '(31) 97722-9988',
    notes: 'Assinatura encerrou sem renovação de pagamento.',
  },
  {
    id: 'user-sub-4',
    name: 'Carlos Mendes (Trimestral)',
    email: 'carlos.quant@yahoo.com',
    role: 'SUBSCRIBER',
    plan: 'TRIMESTRAL',
    status: 'ACTIVE',
    monthlyFee: 126.66, // R$ 380 / 3
    createdAt: addDays(now, -22),
    expiresAt: addDays(now, 68), // 68 dias restantes
    lastLogin: addDays(now, 0),
    activeSessions: 1,
    phone: '(41) 99655-3322',
    notes: 'Plano Trimestral com desconto.',
  },
];

const DEFAULT_TRANSACTIONS: PaymentTransaction[] = [
  {
    id: 'tx-1001',
    userId: 'user-sub-1',
    userEmail: 'rodrigo.trader@gmail.com',
    userName: 'Rodrigo B3 Scalper',
    amount: 149.0,
    method: 'PIX',
    status: 'COMPLETED',
    date: addDays(now, -8),
    daysAdded: 30,
    plan: 'MENSAL',
    transactionCode: 'PIX-B3-8829104',
  },
  {
    id: 'tx-1002',
    userId: 'user-sub-4',
    userEmail: 'carlos.quant@yahoo.com',
    userName: 'Carlos Mendes',
    amount: 380.0,
    method: 'CREDIT_CARD',
    status: 'COMPLETED',
    date: addDays(now, -22),
    daysAdded: 90,
    plan: 'TRIMESTRAL',
    transactionCode: 'CC-STRIPE-492041',
  },
];

export class AuthService {
  private static getUsersFromStorage(): UserProfile[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_USERS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // fallback
    }
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS;
  }

  private static saveUsers(users: UserProfile[]) {
    try {
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch (e) {
      console.error('Error saving users to localStorage', e);
    }
  }

  private static getTransactionsFromStorage(): PaymentTransaction[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TRANSACTIONS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // fallback
    }
    localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(DEFAULT_TRANSACTIONS));
    return DEFAULT_TRANSACTIONS;
  }

  private static saveTransactions(transactions: PaymentTransaction[]) {
    try {
      localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(transactions));
    } catch (e) {
      console.error('Error saving transactions to localStorage', e);
    }
  }

  /**
   * Obtém o usuário atualmente logado (ou o Admin por padrão)
   */
  public static getCurrentUser(): UserProfile {
    const users = this.getUsersFromStorage();
    try {
      const currentId = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (currentId) {
        const found = users.find((u) => u.id === currentId);
        if (found) {
          // Atualiza status dinamicamente se a data de expiração passou
          return this.syncUserStatusWithDate(found);
        }
      }
    } catch {
      // fallback
    }
    // Default: Admin
    const defaultUser = users[0] || DEFAULT_USERS[0];
    localStorage.setItem(STORAGE_KEY_CURRENT, defaultUser.id);
    return defaultUser;
  }

  /**
   * Troca o usuário logado (usado no demo switch ou após login)
   */
  public static setCurrentUser(user: UserProfile) {
    localStorage.setItem(STORAGE_KEY_CURRENT, user.id);
  }

  /**
   * Sincroniza se a data expirou em relação ao momento presente
   */
  public static syncUserStatusWithDate(user: UserProfile): UserProfile {
    if (user.role === 'ADMIN' || user.plan === 'VITALICIO') {
      return user;
    }
    const exp = new Date(user.expiresAt).getTime();
    const current = Date.now();
    if (current > exp && user.status !== 'EXPIRED' && user.status !== 'SUSPENDED') {
      const updated: UserProfile = { ...user, status: 'EXPIRED' };
      this.updateUser(updated);
      return updated;
    }
    return user;
  }

  /**
   * Calcula dias restantes
   */
  public static getRemainingDays(expiresAt: string): number {
    const exp = new Date(expiresAt).getTime();
    const current = Date.now();
    const diff = exp - current;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  /**
   * Verifica se o acesso web está ativo e liberado
   */
  public static isSubscriptionActive(user: UserProfile): boolean {
    if (user.role === 'ADMIN' || user.plan === 'VITALICIO') return true;
    if (user.status === 'EXPIRED' || user.status === 'SUSPENDED') return false;
    return new Date(user.expiresAt).getTime() > Date.now();
  }

  /**
   * Lista todos os usuários cadastrados
   */
  public static getAllUsers(): UserProfile[] {
    const users = this.getUsersFromStorage();
    return users.map((u) => this.syncUserStatusWithDate(u));
  }

  /**
   * Atualiza dados de um usuário
   */
  public static updateUser(user: UserProfile): UserProfile {
    const users = this.getUsersFromStorage();
    const index = users.findIndex((u) => u.id === user.id);
    if (index >= 0) {
      users[index] = user;
      this.saveUsers(users);
    }
    return user;
  }

  /**
   * Extende dias de assinatura (+30, +7, etc.)
   */
  public static extendUserSubscription(userId: string, daysToAdd: number): UserProfile {
    const users = this.getUsersFromStorage();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado');

    const currentExp = new Date(user.expiresAt).getTime();
    const baseTime = currentExp > Date.now() ? currentExp : Date.now();
    const newExpiresAt = new Date(baseTime + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

    const updated: UserProfile = {
      ...user,
      expiresAt: newExpiresAt,
      status: user.status === 'EXPIRED' ? 'ACTIVE' : user.status,
    };

    return this.updateUser(updated);
  }

  /**
   * Altera status (Bloquear / Ativar / Suspender)
   */
  public static setUserStatus(userId: string, status: SubscriptionStatus): UserProfile {
    const users = this.getUsersFromStorage();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado');

    const updated: UserProfile = { ...user, status };
    return this.updateUser(updated);
  }

  /**
   * Cria novo usuário (pelo Admin ou formulário de cadastro)
   */
  public static createUser(params: {
    name: string;
    email: string;
    plan: SubscriptionPlan;
    status?: SubscriptionStatus;
    daysValid?: number;
    phone?: string;
    monthlyFee?: number;
    notes?: string;
  }): UserProfile {
    const users = this.getUsersFromStorage();
    const existing = users.find((u) => u.email.toLowerCase() === params.email.toLowerCase());
    if (existing) {
      throw new Error('Já existe um usuário cadastrado com este e-mail.');
    }

    const days = params.daysValid ?? (params.plan === 'TRIMESTRAL' ? 90 : params.plan === 'ANUAL' ? 365 : 30);
    const fee = params.monthlyFee ?? (params.plan === 'TRIMESTRAL' ? 126.66 : params.plan === 'ANUAL' ? 99.0 : 149.0);

    const newUser: UserProfile = {
      id: `user-${Date.now()}`,
      name: params.name,
      email: params.email.toLowerCase(),
      role: 'SUBSCRIBER',
      plan: params.plan,
      status: params.status || 'ACTIVE',
      monthlyFee: fee,
      createdAt: new Date().toISOString(),
      expiresAt: addDays(new Date(), days),
      lastLogin: new Date().toISOString(),
      activeSessions: 1,
      phone: params.phone,
      notes: params.notes,
    };

    users.push(newUser);
    this.saveUsers(users);
    return newUser;
  }

  /**
   * Exclui usuário da rede
   */
  public static deleteUser(userId: string): boolean {
    let users = this.getUsersFromStorage();
    const target = users.find((u) => u.id === userId);
    if (target?.role === 'ADMIN') {
      throw new Error('Não é permitido excluir a conta Administradora principal.');
    }
    users = users.filter((u) => u.id !== userId);
    this.saveUsers(users);
    return true;
  }

  /**
   * Simulação de Pagamento de Mensalidade (PIX / Cartão)
   */
  public static processPayment(
    userId: string,
    plan: SubscriptionPlan,
    method: 'PIX' | 'CREDIT_CARD'
  ): { user: UserProfile; transaction: PaymentTransaction } {
    const users = this.getUsersFromStorage();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado');

    const daysToAdd = plan === 'TRIMESTRAL' ? 90 : plan === 'ANUAL' ? 365 : 30;
    const amount = plan === 'TRIMESTRAL' ? 380.0 : plan === 'ANUAL' ? 1188.0 : 149.0;

    const updatedUser = this.extendUserSubscription(userId, daysToAdd);

    const tx: PaymentTransaction = {
      id: `tx-${Date.now()}`,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      amount,
      method,
      status: 'COMPLETED',
      date: new Date().toISOString(),
      daysAdded: daysToAdd,
      plan,
      transactionCode: `${method}-${Math.floor(1000000 + Math.random() * 9000000)}`,
    };

    const transactions = this.getTransactionsFromStorage();
    transactions.unshift(tx);
    this.saveTransactions(transactions);

    return { user: updatedUser, transaction: tx };
  }

  /**
   * Obtém histórico de transações financeiras
   */
  public static getTransactions(): PaymentTransaction[] {
    return this.getTransactionsFromStorage();
  }

  /**
   * Calcula KPIs da rede para o painel do Admin
   */
  public static getNetworkKPIs(): NetworkSummaryKPIs {
    const users = this.getAllUsers();
    const subscribers = users.filter((u) => u.role === 'SUBSCRIBER');
    const active = subscribers.filter((u) => u.status === 'ACTIVE');
    const trial = subscribers.filter((u) => u.status === 'TRIAL');
    const expired = subscribers.filter((u) => u.status === 'EXPIRED' || u.status === 'SUSPENDED');

    // MRR = Soma das mensalidades ativas
    const estimatedMRR = active.reduce((acc, u) => acc + (u.monthlyFee || 149), 0);

    // Vencendo nos próximos 7 dias
    const expiringIn7Days = subscribers.filter((u) => {
      const remaining = this.getRemainingDays(u.expiresAt);
      return remaining > 0 && remaining <= 7 && u.status !== 'EXPIRED';
    }).length;

    const retentionRate = subscribers.length > 0
      ? Math.round((active.length / subscribers.length) * 100)
      : 100;

    return {
      totalUsers: users.length,
      activeSubscribers: active.length,
      trialUsers: trial.length,
      expiredUsers: expired.length,
      estimatedMRR,
      expiringIn7Days,
      retentionRate,
    };
  }

  /**
   * Reseta dados de demonstração
   */
  public static resetToDefault() {
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(DEFAULT_USERS));
    localStorage.setItem(STORAGE_KEY_CURRENT, DEFAULT_USERS[0].id);
    localStorage.setItem(STORAGE_KEY_TRANSACTIONS, JSON.stringify(DEFAULT_TRANSACTIONS));
  }
}
