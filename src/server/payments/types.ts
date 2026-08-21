export interface CustomerInfo {
  name: string;
  email: string;
  phone?: string | null;
}

export interface SubscriptionParams {
  subscriptionId: string;
  amount: number;
  currency: string;
  customer: CustomerInfo;
  period: "MONTHLY";
  paymentMethod: "card" | "direct_debit";
  config: Record<string, string>;
}

export interface ChargeParams {
  subscriptionId: string;
  amount: number;
  currency: string;
  token: string;
  config: Record<string, string>;
}

export interface SubscriptionResult {
  gatewaySubscriptionId: string;
  token: string;
  redirectUrl?: string;
  status: "active" | "pending";
  rawResponse?: Record<string, unknown>;
}

export interface ChargeResult {
  success: boolean;
  transactionId: string;
  status: "success" | "failed" | "pending";
  message?: string;
  rawResponse?: Record<string, unknown>;
}

export interface PaymentGatewayModule {
  id: string;
  name: string;
  type: "payhere" | "lankapay";
  description: string;
  supportedMethods: ("card" | "direct_debit")[];
  defaultConfigKeys: string[];

  createRecurringSubscription(params: SubscriptionParams): Promise<SubscriptionResult>;
  chargeRecurringPayment(params: ChargeParams): Promise<ChargeResult>;
  cancelSubscription(subscriptionId: string, token: string, config: Record<string, string>): Promise<{ success: boolean }>;
}
