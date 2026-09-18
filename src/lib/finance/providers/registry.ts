import { prisma } from "@/lib/prisma";
import { ManualPaymentProvider } from "./manual-provider";
import { StripeProvider } from "./stripe-provider";
import type { PaymentProvider } from "./types";
import type { PaymentProviderName } from "@prisma/client";

const PROVIDERS: Record<PaymentProviderName, PaymentProvider> = {
  MANUAL: ManualPaymentProvider,
  STRIPE: StripeProvider,
};

export function getProvider(name: PaymentProviderName): PaymentProvider {
  return PROVIDERS[name];
}

export async function getActiveProvider(): Promise<PaymentProvider> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return getProvider(settings?.activePaymentProvider ?? "MANUAL");
}
