// Client-side helpers for the app shell (STEP 37). The web pages are the same ones the website serves; when they run inside the Android / iPhone app the
// native side injects `window.Capacitor` and adds "LPPApp/<version> (<platform>)" to the user agent. Nothing here imports a native package, so the website's
// bundle is unchanged, and every call degrades to "not available" in an ordinary browser.

export interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Record<string, (...args: unknown[]) => Promise<unknown> | unknown> | undefined>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorLike;
  }
}

export type NativePlatform = "ANDROID" | "IOS";

export interface NativeInfo {
  platform: NativePlatform;
  version: string;
}

export function readNativeInfo(win: Window = window): NativeInfo | null {
  const m = /LPPApp\/(\d{1,5}(?:\.\d{1,5}){0,3}) \((android|ios)\)/i.exec(win.navigator.userAgent);
  if (!m || !win.Capacitor?.isNativePlatform?.()) return null;
  return { version: m[1], platform: m[2].toLowerCase() === "android" ? "ANDROID" : "IOS" };
}

type Plugin = Record<string, (...args: unknown[]) => Promise<unknown> | unknown>;

export function nativePlugin(name: string, win: Window = window): Plugin | null {
  return (win.Capacitor?.Plugins?.[name] as Plugin | undefined) ?? null;
}

const INSTALL_KEY = "lpp_installation_id";

function randomId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
}

/** A random id for this install, made once. It is not a secret and identifies no person; it lets the server tell one installed app from another. */
export async function installationId(win: Window = window): Promise<string> {
  const prefs = nativePlugin("Preferences", win);
  try {
    const got = (await prefs?.get?.({ key: INSTALL_KEY })) as { value?: string | null } | undefined;
    if (got?.value && /^[A-Za-z0-9_-]{16,64}$/.test(got.value)) return got.value;
  } catch {
    /* fall through to a new id */
  }
  try {
    const v = win.localStorage.getItem(INSTALL_KEY);
    if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
  } catch {
    /* storage blocked */
  }
  const id = `i${randomId()}`;
  try {
    await prefs?.set?.({ key: INSTALL_KEY, value: id });
  } catch {
    /* ignore */
  }
  try {
    win.localStorage.setItem(INSTALL_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

/** Paths whose screens show private documents or proposals: the app hides them from screenshots and the app switcher where the phone allows it. */
export const SENSITIVE_PATH = /^\/(dashboard\/(documents|proposals)|my-verification|my-proposals|family\/(documents|proposals))/;