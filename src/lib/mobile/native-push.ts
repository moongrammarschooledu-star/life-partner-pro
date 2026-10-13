import { nativePlugin, type NativePlatform } from "@/lib/mobile/native";

// Turning notifications on inside the app (STEP 37 §19). The permission is asked for ONLY when the person taps "Turn on notifications", after the screen has
// explained why; nothing asks at launch. The token the phone gets back is sent to the server by the app bridge (registration listener).

export type PushEnableResult = "granted" | "denied" | "unavailable";

export async function enableNativePush(platform: NativePlatform): Promise<PushEnableResult> {
  const push = nativePlugin("PushNotifications");
  if (!push) return "unavailable";
  try {
    let status = (await push.checkPermissions?.()) as { receive?: string } | undefined;
    if (status?.receive === "prompt" || status?.receive === "prompt-with-rationale") status = (await push.requestPermissions?.()) as { receive?: string } | undefined;
    if (status?.receive !== "granted") return "denied";
    // Android needs the channel the server names in every message before a notification can be shown.
    if (platform === "ANDROID") await push.createChannel?.({ id: "lpp_updates", name: "Updates", description: "Updates about your account", importance: 3 });
    await push.register?.();
    return "granted";
  } catch {
    return "unavailable";
  }
}

export async function pushPermissionGranted(): Promise<boolean> {
  const push = nativePlugin("PushNotifications");
  try {
    return ((await push?.checkPermissions?.()) as { receive?: string } | undefined)?.receive === "granted";
  } catch {
    return false;
  }
}