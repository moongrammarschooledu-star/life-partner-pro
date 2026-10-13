import { generateKeyPairSync, verify, createPublicKey } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { compareVersions, evaluateVersion, isValidVersion, parseAppUserAgent, policyProblem, safeStoreUrl } from "./version";
import { buildPushContent, DEFAULT_DISPLAY_MODE, effectiveMode, isPushableCategory, safePushPath } from "./push/payload";
import { ALLOWED_LINKS, associatedPathPatterns, parseDeepLink } from "./deep-link";
import { inQuietHours, quietHoursApply } from "./push/quiet-hours";
import { androidCertFingerprints, appleTeamId, mobileIdentity } from "./config";
import { sanitiseEvents, MOBILE_EVENTS } from "./analytics";
import { buildFcmMessage, classifyFcmError, createFcmProvider } from "./push/fcm";
import { buildApnsPayload, classifyApnsResponse, createApnsProvider } from "./push/apns";
import { signEs256, normalisePem } from "./push/jwt";
import { decryptPushToken, encryptPushToken, hashPushToken } from "./token-crypto";

vi.mock("server-only", () => ({}));

// STEP 37 — the pure rules of the mobile layer: version policy, what a push may show, which links may open, quiet hours, the identity configuration,
// analytics sanitising, the push provider requests, and the at-rest protection of push tokens.

describe("app version policy", () => {
  const policy = { minimumSupportedVersion: "1.2.0", recommendedVersion: "1.4.0", latestVersion: "1.5.1" };
  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
  });
  it("tells an old app to update, a middle one it may, a current one nothing", () => {
    expect(evaluateVersion("1.1.9", policy)).toBe("UPDATE_REQUIRED");
    expect(evaluateVersion("1.2.0", policy)).toBe("UPDATE_RECOMMENDED");
    expect(evaluateVersion("1.4.0", policy)).toBe("OK");
    expect(evaluateVersion("9.0.0", policy)).toBe("OK");
  });
  it("a missing, malformed or spoofed version counts as the OLDEST: it cannot dodge a required update", () => {
    for (const v of [undefined, null, "", "latest", "1.2.0-beta", "1..2", "../1.5.0", "1.2.0; drop", "99999999999.0", 5]) expect(evaluateVersion(v, policy), String(v)).toBe("UPDATE_REQUIRED");
    expect(isValidVersion("1.2.3.4")).toBe(true);
    expect(isValidVersion("1.2.3.4.5")).toBe(false);
  });
  it("a policy must be consistent: minimum <= recommended <= latest, all dotted numbers", () => {
    expect(policyProblem(policy)).toBeNull();
    expect(policyProblem({ ...policy, minimumSupportedVersion: "2.0.0" })).toMatch(/minimum/i);
    expect(policyProblem({ ...policy, recommendedVersion: "9.0.0" })).toMatch(/recommended/i);
    expect(policyProblem({ ...policy, latestVersion: "x" })).toMatch(/dotted/);
  });
  it("the update address can only be an official store listing", () => {
    expect(safeStoreUrl("https://play.google.com/store/apps/details?id=com.lifepartnerpro.app")).toContain("play.google.com");
    expect(safeStoreUrl("https://apps.apple.com/app/id123456789")).toContain("apps.apple.com");
    for (const bad of ["http://play.google.com/x", "https://evil.example.com/app.apk", "https://play.google.com.evil.example/x", "https://user:pw@play.google.com/x", "javascript:alert(1)", "market://details?id=x", "", null, 5]) expect(safeStoreUrl(bad), String(bad)).toBeNull();
  });
  it("reads the app's own user agent token", () => {
    expect(parseAppUserAgent("Mozilla/5.0 LPPApp/1.3.0 (android)")).toEqual({ version: "1.3.0", platform: "ANDROID" });
    expect(parseAppUserAgent("Mozilla/5.0 LPPApp/2.0 (ios) Safari")).toEqual({ version: "2.0", platform: "IOS" });
    expect(parseAppUserAgent("Mozilla/5.0 Chrome")).toBeNull();
    expect(parseAppUserAgent("LPPApp/1.0.0 (windows)")).toBeNull();
  });
});

describe("what a push notification may show", () => {
  const inApp = { title: "Proposal update", body: "There is an update on a proposal." };
  it("PRIVATE is the default and is one generic line", () => {
    expect(DEFAULT_DISPLAY_MODE).toBe("PRIVATE");
    expect(effectiveMode(null, null)).toBe("PRIVATE");
    expect(effectiveMode("nonsense", "garbage")).toBe("PRIVATE");
    const c = buildPushContent("PRIVATE", inApp, "n1", "/my-proposals");
    expect(c).toEqual({ title: "Life Partner Pro", body: "You have a new update in Life Partner Pro.", data: { n: "n1", p: "/my-proposals" } });
  });
  it("MINIMAL gives no hint, OFF gives nothing, FULL uses only the existing privacy-safe app text", () => {
    expect(buildPushContent("MINIMAL", inApp, "n1", "/x")?.body).toBe("Open the app.");
    expect(buildPushContent("OFF", inApp, "n1", "/x")).toBeNull();
    expect(buildPushContent("FULL", inApp, "n1", "/my-proposals")?.title).toBe("Proposal update");
  });
  it("the device choice wins over the account choice", () => {
    expect(effectiveMode("OFF", "FULL")).toBe("OFF");
    expect(effectiveMode(null, "MINIMAL")).toBe("MINIMAL");
  });
  it("the data part only ever carries an id and a plain app path", () => {
    for (const bad of ["https://evil.example.com", "/dashboard?token=abc", "//evil", "/a b", "/../x", "javascript:1", "", null, undefined]) expect(safePushPath(bad as string), String(bad)).toBe("/dashboard");
    expect(safePushPath("/my-proposals")).toBe("/my-proposals");
    const c = buildPushContent("PRIVATE", { title: "Muhammad's number is 03001234567", body: "Call 03001234567" }, "n1", "/dashboard?phone=0300")!;
    expect(JSON.stringify(c)).not.toMatch(/0300|Muhammad|phone/);
  });
  it("marketing is never pushed; low-priority noise is not pushed either", () => {
    expect(isPushableCategory("MARKETING", "HIGH")).toBe(false);
    expect(isPushableCategory(null, "HIGH")).toBe(false);
    expect(isPushableCategory("PROPOSAL", "NORMAL")).toBe(true);
    expect(isPushableCategory("SYSTEM", "LOW")).toBe(false);
    expect(isPushableCategory("SECURITY", "LOW")).toBe(true);
  });
});

describe("deep links", () => {
  const hosts = ["lifepartnerpro.vercel.app"];
  it("opens a known route, relative or on this site", () => {
    expect(parseDeepLink("/dashboard", hosts)).toMatchObject({ ok: true, path: "/dashboard" });
    expect(parseDeepLink("https://lifepartnerpro.vercel.app/my-proposals", hosts)).toMatchObject({ ok: true, path: "/my-proposals" });
    expect(parseDeepLink("/dashboard/", hosts)).toMatchObject({ ok: true, path: "/dashboard" });
    expect(parseDeepLink("/dashboard/proposals/LPP-RP-000123", hosts)).toMatchObject({ ok: true, id: "LPP-RP-000123" });
  });
  it("drops the query string and refuses one that carries a secret", () => {
    expect(parseDeepLink("/dashboard?utm=x", hosts)).toMatchObject({ ok: true, path: "/dashboard" });
    for (const q of ["?token=abc", "?password=x", "?mobile=0300", "?private_key=k", "?otp=123456", "?x=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab"]) expect(parseDeepLink(`/dashboard${q}`, hosts), q).toMatchObject({ ok: false, reason: "SECRET_IN_URL" });
  });
  it("refuses other hosts, other schemes, userinfo, relative tricks, traversal and unknown routes", () => {
    const refused = ["https://evil.example.com/dashboard", "http://lifepartnerpro.vercel.app/dashboard", "javascript:alert(1)", "myapp://dashboard", "//evil.example.com/dashboard", "https://user:pw@lifepartnerpro.vercel.app/dashboard", "/dashboard/../admin", "/dashboard/%2e%2e/admin", "/%2e%2e/admin", "/admin/dashboard", "/api/admin/users", "/dashboard//proposals", "/dashboard\\proposals", "/dashboard/proposals/../../admin", "/dashboard/proposals/", "/dashboard/proposals/a", "/dashboard/proposals/x/y", "/family/dashboard/extra", "", "   ", `/${"a".repeat(400)}`];
    for (const r of refused) expect(parseDeepLink(r, hosts), r).toMatchObject({ ok: false });
    for (const r of [null, undefined, 5, {}, []]) expect(parseDeepLink(r, hosts)).toMatchObject({ ok: false, reason: "INVALID" });
  });
  it("an encoded control character or space cannot reach a route", () => {
    for (const r of ["/dashboard%00", "/dashboard%0a", "/dashboard%20", "/dash\u0000board"]) expect(parseDeepLink(r, hosts), r).toMatchObject({ ok: false });
  });
  it("the allow-list holds only application routes, never an admin or API route, and the association files list the same set", () => {
    for (const l of ALLOWED_LINKS) expect(l.pattern, l.pattern).toMatch(/^\/(dashboard|my-|account-settings|report-concern|family\/)/);
    for (const l of ALLOWED_LINKS) expect(l.pattern).not.toMatch(/admin|api|private|internal/);
    const patterns = associatedPathPatterns();
    expect(patterns).toContain("/dashboard/proposals/*");
    expect(patterns.length).toBe(new Set(patterns).size);
    for (const p of patterns) expect(p).not.toMatch(/token|secret|\?|#/);
  });
});

describe("quiet hours for push", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 13, h, 30));
  it("handles a window that crosses midnight, and no window", () => {
    expect(inQuietHours(at(23), 22, 7, "UTC")).toBe(true);
    expect(inQuietHours(at(3), 22, 7, "UTC")).toBe(true);
    expect(inQuietHours(at(12), 22, 7, "UTC")).toBe(false);
    expect(inQuietHours(at(8), 9, 17, "UTC")).toBe(false);
    expect(inQuietHours(at(10), 9, 17, "UTC")).toBe(true);
    expect(inQuietHours(at(10), 9, 9, "UTC")).toBe(false);
    expect(inQuietHours(at(10), null, null, "UTC")).toBe(false);
    expect(inQuietHours(at(10), 9, 99, "UTC")).toBe(false);
  });
  it("uses the platform time zone", () => {
    // 20:30 UTC is 01:30 the next day in Asia/Karachi (UTC+5)
    expect(inQuietHours(at(20), 0, 6, "Asia/Karachi")).toBe(true);
    expect(inQuietHours(at(20), 0, 6, "UTC")).toBe(false);
  });
  it("never holds back high or urgent notices", () => {
    expect(quietHoursApply("URGENT")).toBe(false);
    expect(quietHoursApply("HIGH")).toBe(false);
    expect(quietHoursApply("NORMAL")).toBe(true);
  });
});

describe("app identity configuration", () => {
  it("falls back to the documented defaults and rejects malformed identifiers", () => {
    expect(mobileIdentity({}).androidPackageId).toBe("com.lifepartnerpro.app");
    expect(mobileIdentity({ ANDROID_PACKAGE_ID: "com.example.published" }).androidPackageId).toBe("com.example.published");
    expect(mobileIdentity({ ANDROID_PACKAGE_ID: "not a package; rm -rf" }).androidPackageId).toBe("com.lifepartnerpro.app");
    expect(mobileIdentity({ IOS_BUNDLE_ID: "evil" }).iosBundleId).toBe("com.lifepartnerpro.app");
  });
  it("derives the allowed hosts from the app URL plus an explicit list", () => {
    expect(mobileIdentity({ NEXT_PUBLIC_APP_URL: "https://www.example.com" }).appHosts).toEqual(["www.example.com"]);
    expect(mobileIdentity({ APP_URL: "https://a.example.com", MOBILE_ALLOWED_HOSTS: "b.example.com, bad host, C.EXAMPLE.com" }).appHosts).toEqual(["a.example.com", "b.example.com", "c.example.com"]);
  });
  it("only well-formed public fingerprints and team ids are used", () => {
    const fp = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
    expect(androidCertFingerprints({ ANDROID_SHA256_CERT_FINGERPRINTS: `${fp.toLowerCase()}, nonsense, ${fp}` })).toEqual([fp, fp]);
    expect(androidCertFingerprints({})).toEqual([]);
    expect(appleTeamId({ APPLE_TEAM_ID: "ABCDE12345" })).toBe("ABCDE12345");
    expect(appleTeamId({ APPLE_TEAM_ID: "short" })).toBeNull();
    expect(appleTeamId({})).toBeNull();
  });
});

describe("app analytics", () => {
  it("keeps only the fixed event names and counts repeats", () => {
    const m = sanitiseEvents(["APP_OPENED", "APP_OPENED", { name: "PROPOSAL_VIEWED", phone: "0300" }, "STOLEN_DATA", { name: "x".repeat(50) }, 5, null, { name: "APP_OPENED", profileId: "p1" }]);
    expect([...m.entries()].sort()).toEqual([["APP_OPENED", 3], ["PROPOSAL_VIEWED", 1]]);
    expect(sanitiseEvents("APP_OPENED").size).toBe(0);
    expect(sanitiseEvents(Array.from({ length: 100 }, () => "APP_OPENED")).get("APP_OPENED")).toBe(25);
  });
  it("the event list is exactly the brief's twelve names, none of which can carry content", () => {
    expect([...MOBILE_EVENTS]).toHaveLength(12);
    for (const e of MOBILE_EVENTS) expect(e).toMatch(/^[A-Z_]+$/);
  });
});

describe("push provider requests", () => {
  const content = { title: "Life Partner Pro", body: "You have a new update in Life Partner Pro.", data: { n: "n1", p: "/my-proposals" } };
  let rsaPem = "";
  let ecPem = "";
  beforeAll(() => {
    rsaPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    ecPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  });

  it("FCM: builds a notification + data message with nothing else in it", () => {
    const m = buildFcmMessage("tok", content);
    expect(m.message.notification).toEqual({ title: content.title, body: content.body });
    expect(m.message.data).toEqual({ n: "n1", p: "/my-proposals" });
    expect(JSON.stringify(m)).not.toMatch(/phone|email|profile/i);
  });
  it("FCM: maps error responses to what the caller should do", () => {
    expect(classifyFcmError(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }).status).toBe("INVALID_TOKEN");
    expect(classifyFcmError(400, { error: { status: "INVALID_ARGUMENT" } }).status).toBe("INVALID_TOKEN");
    expect(classifyFcmError(429, {})).toMatchObject({ status: "FAILED", retryable: true });
    expect(classifyFcmError(503, {})).toMatchObject({ status: "FAILED", retryable: true });
    expect(classifyFcmError(401, {})).toMatchObject({ status: "FAILED", retryable: false });
  });
  it("FCM: is not configured without its three server settings, and then sends nothing", async () => {
    const fetchSpy = vi.fn();
    const p = createFcmProvider({}, fetchSpy as unknown as typeof fetch);
    expect(p.isConfigured()).toBe(false);
    expect(await p.send("t".repeat(60), content)).toMatchObject({ status: "FAILED", reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("FCM: gets an access token with a signed assertion, then posts the message to the project", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFake = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ name: "projects/p1/messages/abc123" }), { status: 200 });
    });
    const p = createFcmProvider({ FCM_PROJECT_ID: "p1", FCM_CLIENT_EMAIL: "svc@p1.iam.gserviceaccount.com", FCM_PRIVATE_KEY: rsaPem.replace(/\n/g, "\\n") }, fetchFake as unknown as typeof fetch);
    expect(p.isConfigured()).toBe(true);
    const out = await p.send("T".repeat(80), content);
    expect(out).toEqual({ status: "SENT", providerMessageId: "projects/p1/messages/abc123" });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0].init.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1].url).toBe("https://fcm.googleapis.com/v1/projects/p1/messages:send");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer ya29.test");
    // the access token is cached: a second send does not authenticate again
    await p.send("T".repeat(80), content);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });
  it("FCM: validates the token format and reports a dead token as invalid", async () => {
    const fetchFake = vi.fn(async (url: string) => (url.includes("oauth2") ? new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 }) : new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 })));
    const p = createFcmProvider({ FCM_PROJECT_ID: "p1", FCM_CLIENT_EMAIL: "e@x", FCM_PRIVATE_KEY: rsaPem }, fetchFake as unknown as typeof fetch);
    expect(p.validateToken("short")).toBe(false);
    expect(p.validateToken("a b c".repeat(20))).toBe(false);
    expect(p.validateToken("A".repeat(60))).toBe(true);
    expect(await p.send("A".repeat(60), content)).toMatchObject({ status: "INVALID_TOKEN" });
  });

  it("APNs: builds the alert payload with only the id and the path", () => {
    expect(buildApnsPayload(content)).toEqual({ aps: { alert: { title: content.title, body: content.body }, sound: "default" }, n: "n1", p: "/my-proposals" });
  });
  it("APNs: maps Apple's answers", () => {
    expect(classifyApnsResponse(200, undefined).status).toBe("SENT");
    expect(classifyApnsResponse(410, "Unregistered").status).toBe("INVALID_TOKEN");
    expect(classifyApnsResponse(400, "BadDeviceToken").status).toBe("INVALID_TOKEN");
    expect(classifyApnsResponse(429, "TooManyRequests")).toMatchObject({ status: "FAILED", retryable: true });
    expect(classifyApnsResponse(403, "InvalidProviderToken")).toMatchObject({ status: "FAILED", retryable: false });
  });
  it("APNs: is not configured without its settings, and validates the token format", async () => {
    const p = createApnsProvider({});
    expect(p.isConfigured()).toBe(false);
    expect(await p.send("a".repeat(64), content)).toMatchObject({ status: "FAILED", reason: "not_configured" });
    expect(p.validateToken("a".repeat(64))).toBe(true);
    expect(p.validateToken("not-hex")).toBe(false);
  });
  it("the Apple provider token is an ES256 JWT with a raw (r||s) signature that the public key verifies", () => {
    const jwt = signEs256({ alg: "ES256", kid: "KEYID12345" }, { iss: "TEAMID1234", iat: 1 }, normalisePem(ecPem.replace(/\n/g, "\\n")));
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAMID1234", iat: 1 });
    const sig = Buffer.from(s, "base64url");
    expect(sig.length).toBe(64);
    const pub = createPublicKey(ecPem);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
  });
});

describe("push token protection", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "unit-test-secret-unit-test-secret-1234";
  });
  it("round-trips, differs every time, and a tampered value reads as nothing", () => {
    const token = "fcm-token-" + "x".repeat(60);
    const a = encryptPushToken(token);
    const b = encryptPushToken(token);
    expect(a).not.toBe(b);
    expect(a).not.toContain(token);
    expect(decryptPushToken(a)).toBe(token);
    expect(decryptPushToken(a.slice(0, -3) + "AAA")).toBeNull();
    expect(decryptPushToken("v1.a.b")).toBeNull();
    expect(decryptPushToken("plain")).toBeNull();
  });
  it("the lookup hash is stable and does not reveal the token", () => {
    expect(hashPushToken("abc")).toBe(hashPushToken("abc"));
    expect(hashPushToken("abc")).not.toBe(hashPushToken("abd"));
    expect(hashPushToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
