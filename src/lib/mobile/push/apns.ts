import { connect } from "http2";
import type { PushContent } from "@/lib/mobile/push/payload";
import { signEs256, normalisePem } from "@/lib/mobile/push/jwt";
import { PUSH_TIMEOUT_MS, type PushOutcome, type PushProvider } from "@/lib/mobile/push/types";

// Apple Push Notification service, token-based (iOS). Credentials come from the server environment only:
//   APNS_KEY_ID, APNS_TEAM_ID (or APPLE_TEAM_ID), APNS_PRIVATE_KEY (the .p8 key contents), APNS_ENVIRONMENT (production | sandbox)
// The app's bundle id (the push "topic") is APNS_BUNDLE_ID, else IOS_BUNDLE_ID, else the documented default.

interface ApnsEnv {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APPLE_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  IOS_BUNDLE_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_ENVIRONMENT?: string;
}

export function buildApnsPayload(content: PushContent) {
  return { aps: { alert: { title: content.title, body: content.body }, sound: "default" }, n: content.data.n, p: content.data.p };
}

/** `reason` is Apple's own short error word (for example BadDeviceToken). */
export function classifyApnsResponse(status: number, reason: string | undefined): PushOutcome {
  if (status === 200) return { status: "SENT" };
  if (status === 410 || reason === "Unregistered" || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") return { status: "INVALID_TOKEN", reason: (reason ?? "unregistered").toLowerCase() };
  if (status === 429 || status >= 500) return { status: "FAILED", reason: `apns_${status}`, retryable: true };
  return { status: "FAILED", reason: `apns_${reason ?? status}`.slice(0, 60), retryable: false };
}

export function createApnsProvider(env: ApnsEnv = process.env as ApnsEnv): PushProvider {
  let cached: { jwt: string; at: number } | null = null;
  const team = () => (env.APNS_TEAM_ID || env.APPLE_TEAM_ID || "").trim();
  const topic = () => (env.APNS_BUNDLE_ID || env.IOS_BUNDLE_ID || "com.lifepartnerpro.app").trim();
  const configured = () => Boolean(env.APNS_KEY_ID?.trim() && team() && env.APNS_PRIVATE_KEY?.trim());
  const host = () => (env.APNS_ENVIRONMENT?.trim().toLowerCase() === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");

  // Apple asks for a provider token that is reused for up to an hour, and refreshed no more than once every 20 minutes.
  function providerToken(): string {
    const now = Math.floor(Date.now() / 1000);
    if (cached && now - cached.at < 40 * 60) return cached.jwt;
    const jwt = signEs256({ alg: "ES256", kid: env.APNS_KEY_ID }, { iss: team(), iat: now }, normalisePem(env.APNS_PRIVATE_KEY as string));
    cached = { jwt, at: now };
    return jwt;
  }

  function send(token: string, content: PushContent): Promise<PushOutcome> {
    if (!configured()) return Promise.resolve({ status: "FAILED", reason: "not_configured", retryable: false });
    return new Promise<PushOutcome>((resolve) => {
      let done = false;
      const finish = (o: PushOutcome) => {
        if (done) return;
        done = true;
        client.close();
        resolve(o);
      };
      const client = connect(host());
      client.on("error", () => finish({ status: "FAILED", reason: "network", retryable: true }));
      client.setTimeout(PUSH_TIMEOUT_MS, () => finish({ status: "FAILED", reason: "timeout", retryable: true }));
      try {
        const req = client.request({
          ":method": "POST",
          ":path": `/3/device/${token}`,
          authorization: `bearer ${providerToken()}`,
          "apns-topic": topic(),
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        });
        let status = 0;
        let body = "";
        req.on("response", (h) => {
          status = Number(h[":status"]);
        });
        req.setEncoding("utf8");
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          let reason: string | undefined;
          try {
            reason = (JSON.parse(body) as { reason?: string }).reason;
          } catch {
            /* an empty body is the success case */
          }
          finish(classifyApnsResponse(status, reason));
        });
        req.on("error", () => finish({ status: "FAILED", reason: "network", retryable: true }));
        req.end(JSON.stringify(buildApnsPayload(content)));
      } catch {
        finish({ status: "FAILED", reason: "network", retryable: true });
      }
    });
  }

  return {
    id: "APNS",
    isConfigured: configured,
    // An APNs device token is 64 hexadecimal characters (or more, in newer formats).
    validateToken: (t) => /^[0-9a-fA-F]{64,200}$/.test(t),
    send,
    sendBatch: async (tokens, content) => Promise.all(tokens.map((t) => send(t, content))),
  };
}