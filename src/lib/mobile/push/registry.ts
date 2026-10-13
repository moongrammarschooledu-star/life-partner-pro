import { createApnsProvider } from "@/lib/mobile/push/apns";
import { createFcmProvider } from "@/lib/mobile/push/fcm";
import type { PushProvider, PushProviderId } from "@/lib/mobile/push/types";

// One provider instance per push service for the life of the server process (they cache their short-lived access tokens).
let fcm: PushProvider | null = null;
let apns: PushProvider | null = null;

export function getPushProvider(id: PushProviderId): PushProvider {
  if (id === "FCM") return (fcm ??= createFcmProvider());
  return (apns ??= createApnsProvider());
}

export function providerForPlatform(platform: "ANDROID" | "IOS"): PushProvider {
  return getPushProvider(platform === "ANDROID" ? "FCM" : "APNS");
}