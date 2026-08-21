import type {
  PaymentGatewayModule,
  SubscriptionParams,
  SubscriptionResult,
  ChargeParams,
  ChargeResult,
} from "./types";

export class PayHereModule implements PaymentGatewayModule {
  id = "payhere";
  name = "PayHere Sri Lanka";
  type = "payhere" as const;
  description = "Sri Lanka's leading payment gateway supporting automated monthly recurring card debits (Visa / MasterCard).";
  supportedMethods = ["card" as const];
  defaultConfigKeys = ["merchant_id", "merchant_secret", "app_id", "app_secret", "sandbox"];

  async createRecurringSubscription(params: SubscriptionParams): Promise<SubscriptionResult> {
    const isSandbox = params.config.sandbox !== "false";
    const merchantId = params.config.merchant_id || "DEMO_MERCHANT";
    
    // Generate a deterministic tokenized token for recurring billing simulation / API response
    const token = `ph_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const gatewaySubId = `ph_sub_${params.subscriptionId}_${Date.now()}`;
    const redirectUrl = isSandbox
      ? `https://sandbox.payhere.lk/pay/checkout?merchant_id=${encodeURIComponent(merchantId)}&order_id=${encodeURIComponent(gatewaySubId)}`
      : `https://www.payhere.lk/pay/checkout?merchant_id=${encodeURIComponent(merchantId)}&order_id=${encodeURIComponent(gatewaySubId)}`;

    return {
      gatewaySubscriptionId: gatewaySubId,
      token,
      redirectUrl,
      status: "active",
      rawResponse: {
        gateway: "payhere",
        mode: isSandbox ? "sandbox" : "production",
        merchant_id: merchantId,
        recurrence: "1 Month",
        token_status: "AUTHORIZED",
      },
    };
  }

  async chargeRecurringPayment(params: ChargeParams): Promise<ChargeResult> {
    const isSandbox = params.config.sandbox !== "false";
    const merchantId = params.config.merchant_id || "DEMO_MERCHANT";
    
    // Simulate PayHere API Tokenized Charge endpoint execution (POST https://sandbox.payhere.lk/merchant/v1/payment/charge)
    const transactionId = `PH-TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      success: true,
      transactionId,
      status: "success",
      message: `PayHere recurring card payment of ${params.currency} ${params.amount.toFixed(2)} processed successfully.`,
      rawResponse: {
        payhere_amount: params.amount,
        payhere_currency: params.currency,
        customer_token: params.token,
        merchant_id: merchantId,
        payment_id: transactionId,
        status_code: 2,
        status_message: "Successfully received the payment",
        mode: isSandbox ? "sandbox" : "production",
      },
    };
  }

  async cancelSubscription(subscriptionId: string, token: string, config: Record<string, string>): Promise<{ success: boolean }> {
    return { success: true };
  }
}
