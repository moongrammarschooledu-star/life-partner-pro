import type { PushContent } from "@/lib/mobile/push/payload";
import { signRs256, normalisePem } from "@/lib/mobile/push/jwt";
import { PUSH_TIMEOUT_MS, type PushOutcome, type PushProvider } from "@/lib/mobile/push/types";

// Firebase Cloud Messaging, HTTP v1 API (Android). Credentials are read from the server environment only:
//   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY   (the Firebase service account; server-side secrets, never in the app)

interface FcmEnv {
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}

type Fetch = typeof fetch;

export function buildFcmMessage(token: string, content: PushContent) {
  return {
    message: {
      token,
      notification: { title: content.title, body: content.body },
      data: { n: content.data.n, p: content.data.p },
      android: { priority: "HIGH" as const, notification: { channel_id: "lpp_updates" } },
    },
  };
}

/** Maps an FCM error response onto what the caller should do. */
export function classifyFcmError(status: number, body: unknown): PushOutcome {
  const code = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } })?.error;
  const errorCode = code?.details?.find((d) => d.errorCode)?.errorCode ?? code?.status ?? "";
  if (status === 404 || errorCode === "UNREGISTERED") return { status: "INVALID_TOKEN", reason: "unregistered" };
  if (status === 400 && (errorCode === "INVALID_ARGUMENT" || errorCode === "SENDER_ID_MISMATCH")) return { status: "INVALID_TOKEN", reason: errorCode.toLowerCase() };
  if (status === 403 && errorCode === "SENDER_ID_MISMATCH") return { status: "INVALID_TOKEN", reason: "sender_id_mismatch" };
  if (status === 429 || status >= 500) return { status: "FAILED", reason: `fcm_${status}`, retryable: true };
  return { status: "FAILED", reason: `fcm_${status}`, retryable: false };
}

export function createFcmProvider(env: FcmEnv = process.env as FcmEnv, doFetch: Fetch = fetch): PushProvider {
  let cached: { token: string; expiresAt: number } | null = null;

  const configured = () => Boolean(env.FCM_PROJECT_ID?.trim() && env.FCM_CLIENT_EMAIL?.trim() && env.FCM_PRIVATE_KEY?.trim());

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > now) return cached.token;
    const assertion = signRs256(
      { alg: "RS256", typ: "JWT" },
      { iss: env.FCM_CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
      normalisePem(env.FCM_PRIVATE_KEY as string),
    );
    const res = await doFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`fcm_auth_${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("fcm_auth_empty");
    cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
    return cached.token;
  }

  async function send(token: string, content: PushContent): Promise<PushOutcome> {
    if (!configured()) return { status: "FAILED", reason: "not_configured", retryable: false };
    try {
      const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FCM_PROJECT_ID as string)}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildFcmMessage(token, content)),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { status: "SENT", providerMessageId: typeof (body as { name?: string }).name === "string" ? (body as { name: string }).name.slice(-120) : undefined };
      return classifyFcmError(res.status, body);
    } catch (err) {
      return { status: "FAILED", reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network", retryable: true };
    }
  }

  return {
    id: "FCM",
    isConfigured: configured,
    // Real FCM registration tokens are long opaque strings of URL-safe characters, colons and dashes.
    validateToken: (t) => /^[A-Za-z0-9:_\-.]{50,4096}$/.test(t),
    send,
    sendBatch: async (tokens, content) => Promise.all(tokens.map((t) => send(t, content))),
  };
}