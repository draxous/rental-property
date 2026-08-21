import type {
  PaymentGatewayModule,
  SubscriptionParams,
  SubscriptionResult,
  ChargeParams,
  ChargeResult,
} from "./types";

export class LankaPayModule implements PaymentGatewayModule {
  id = "lankapay";
  name = "LankaPay DirectDebit / Card";
  type = "lankapay" as const;
  description = "Sri Lanka's national payment network supporting direct bank account debits (CEFT/DirectDebit) and card recurring billing.";
  supportedMethods = ["card" as const, "direct_debit" as const];
  defaultConfigKeys = ["merchant_code", "api_key", "security_cert", "sandbox"];

  async createRecurringSubscription(params: SubscriptionParams): Promise<SubscriptionResult> {
    const isSandbox = params.config.sandbox !== "false";
    const merchantCode = params.config.merchant_code || "LK_DEMO_MERCHANT";

    const token = `lkp_mandate_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const gatewaySubId = `LKP-MANDATE-${params.subscriptionId}-${Date.now()}`;

    return {
      gatewaySubscriptionId: gatewaySubId,
      token,
      status: "active",
      rawResponse: {
        gateway: "lankapay",
        merchant_code: merchantCode,
        payment_method: params.paymentMethod,
        mandate_status: "APPROVED",
        mode: isSandbox ? "sandbox" : "production",
      },
    };
  }

  async chargeRecurringPayment(params: ChargeParams): Promise<ChargeResult> {
    const isSandbox = params.config.sandbox !== "false";
    const merchantCode = params.config.merchant_code || "LK_DEMO_MERCHANT";

    // Simulate LankaPay DirectDebit API (POST /api/v1/directdebit/execute)
    const transactionId = `LKP-TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      success: true,
      transactionId,
      status: "success",
      message: `LankaPay automated recurring debit of ${params.currency} ${params.amount.toFixed(2)} completed successfully.`,
      rawResponse: {
        lankapay_amount: params.amount,
        lankapay_currency: params.currency,
        mandate_token: params.token,
        merchant_code: merchantCode,
        reference: transactionId,
        response_code: "00",
        response_desc: "Approved or completed successfully",
        mode: isSandbox ? "sandbox" : "production",
      },
    };
  }

  async cancelSubscription(subscriptionId: string, token: string, config: Record<string, string>): Promise<{ success: boolean }> {
    return { success: true };
  }
}
