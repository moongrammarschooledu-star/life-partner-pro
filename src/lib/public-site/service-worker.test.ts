import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import vm from "vm";

// Runs the real public/sw.js in a sandbox with a fake cache and network, and proves the privacy rule from STEP 35 §32: only public static files
// are ever stored; pages, API responses and anything private are not cached, and not even intercepted.

type Handler = (event: Record<string, unknown>) => void;

function loadWorker(networkUp = true) {
  const handlers: Record<string, Handler> = {};
  const stored = new Map<string, string>();
  const fetched: string[] = [];
  const cache = {
    addAll: async (urls: string[]) => urls.forEach((u) => stored.set(u, "precached")),
    put: async (req: { url: string }) => void stored.set(new URL(req.url).pathname, "runtime"),
  };
  const sandbox: Record<string, unknown> = {
    URL,
    Promise,
    Response: { error: () => ({ error: true }) },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (req: string | { url: string }) => {
        const key = typeof req === "string" ? req : new URL(req.url).pathname;
        return stored.has(key) ? { cached: key } : undefined;
      },
    },
    fetch: async (req: { url: string }) => {
      fetched.push(req.url);
      if (!networkUp) throw new Error("offline");
      return { ok: true, type: "basic", clone: () => ({ ok: true, type: "basic" }) };
    },
    self: {
      location: { origin: "https://site.test" },
      addEventListener: (name: string, h: Handler) => void (handlers[name] = h),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), sandbox);

  async function request(url: string, init: { method?: string; mode?: string } = {}) {
    let responded: Promise<unknown> | null = null;
    handlers.fetch({ request: { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" }, respondWith: (p: Promise<unknown>) => void (responded = p) });
    const result = responded ? await responded : undefined;
    // let any fire-and-forget cache.put settle
    await new Promise((r) => setTimeout(r, 0));
    return { intercepted: responded !== null, result };
  }
  async function install() {
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
  }
  return { request, install, stored, fetched };
}

describe("service worker privacy rule", () => {
  it("precaches only the offline page and brand icons", async () => {
    const sw = loadWorker();
    await sw.install();
    expect([...sw.stored.keys()].sort()).toEqual(["/icons/icon-192.png", "/icons/icon-512.png", "/offline"]);
  });

  it("never intercepts API calls, uploads, non-GET requests or other sites", async () => {
    const sw = loadWorker();
    await sw.install();
    for (const url of ["https://site.test/api/my-profile", "https://site.test/api/my-documents/1/download", "https://site.test/api/my-proposals", "https://site.test/private-uploads/x.pdf"]) {
      expect((await sw.request(url)).intercepted, url).toBe(false);
    }
    expect((await sw.request("https://site.test/api/my-profile", { method: "POST" })).intercepted).toBe(false);
    expect((await sw.request("https://cdn.other.test/lib.js")).intercepted).toBe(false);
    expect(sw.fetched).toEqual([]);
  });

  it("stores no page: a signed-in navigation goes to the network and nothing is cached", async () => {
    const sw = loadWorker();
    await sw.install();
    const before = new Set(sw.stored.keys());
    for (const url of ["https://site.test/dashboard", "https://site.test/my-proposals", "https://site.test/family/dashboard", "https://site.test/admin/dashboard", "https://site.test/"]) {
      const r = await sw.request(url, { mode: "navigate" });
      expect(r.intercepted, url).toBe(true);
    }
    expect(new Set(sw.stored.keys())).toEqual(before);
  });

  it("falls back to the generic offline page when the network is down", async () => {
    const sw = loadWorker(false);
    await sw.install();
    const r = await sw.request("https://site.test/my-proposals", { mode: "navigate" });
    expect(r.result).toEqual({ cached: "/offline" });
  });

  it("caches only Next's immutable static files and the icons at run time", async () => {
    const sw = loadWorker();
    await sw.install();
    await sw.request("https://site.test/_next/static/chunks/app.js");
    await sw.request("https://site.test/icons/icon-maskable-512.png");
    expect(sw.stored.get("/_next/static/chunks/app.js")).toBe("runtime");
    expect(sw.stored.get("/icons/icon-maskable-512.png")).toBe("runtime");
    // anything else that is a plain GET (an image URL, a data file) is left alone
    expect((await sw.request("https://site.test/some/other.json")).intercepted).toBe(false);
    expect(sw.stored.has("/some/other.json")).toBe(false);
  });

  it("the worker is served uncached and the registration is production-only", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('source: "/sw.js"');
    expect(config).toContain("no-cache, no-store, must-revalidate");
    expect(readFileSync(join(process.cwd(), "src/components/public/pwa-register.tsx"), "utf8")).toContain('process.env.NODE_ENV !== "production"');
  });
});
