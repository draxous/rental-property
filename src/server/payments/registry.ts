import type { PaymentGatewayModule } from "./types";
import { PayHereModule } from "./payhere";
import { LankaPayModule } from "./lankapay";

class PaymentGatewayRegistry {
  private modules: Map<string, PaymentGatewayModule> = new Map();

  constructor() {
    this.register(new PayHereModule());
    this.register(new LankaPayModule());
  }

  register(module: PaymentGatewayModule) {
    this.modules.set(module.id, module);
  }

  get(id: string): PaymentGatewayModule | undefined {
    return this.modules.get(id);
  }

  list(): PaymentGatewayModule[] {
    return Array.from(this.modules.values());
  }
}

export const paymentRegistry = new PaymentGatewayRegistry();
