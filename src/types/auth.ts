export type UserRole = 'ADMIN' | 'SUBSCRIBER';

export type SubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED';

export type SubscriptionPlan = 'MENSAL' | 'TRIMESTRAL' | 'ANUAL' | 'VITALICIO';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  monthlyFee: number; // e.g. R$ 149.00
  createdAt: string; // ISO date
  expiresAt: string; // ISO date
  lastLogin: string;
  activeSessions: number;
  phone?: string;
  notes?: string;
}

export interface PaymentTransaction {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  amount: number;
  method: 'PIX' | 'CREDIT_CARD' | 'BOLETO';
  status: 'COMPLETED' | 'PENDING' | 'REFUNDED';
  date: string;
  daysAdded: number;
  plan: SubscriptionPlan;
  transactionCode: string;
}

export interface NetworkSummaryKPIs {
  totalUsers: number;
  activeSubscribers: number;
  trialUsers: number;
  expiredUsers: number;
  estimatedMRR: number; // Monthly Recurring Revenue
  expiringIn7Days: number;
  retentionRate: number;
}
