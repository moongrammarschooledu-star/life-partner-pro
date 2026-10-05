import { beforeAll, describe, expect, it } from "vitest";
import { ContentVersionStatus, MarketingCampaignStatus } from "@prisma/client";
import {
  CAMPAIGN_TRANSITIONS, CONTENT_VERSION_TRANSITIONS, canTransitionCampaign, canTransitionContentVersion,
} from "@/lib/marketing/constants";
import { assertScanFresh, scanMarketingContent } from "@/lib/marketing/content-policy";
import { computeContactHashes, lastTenDigits, normalizeEmail, normalizePhoneE164 } from "@/lib/marketing/normalize";
import {
  FORM_TOKEN_MAX_AGE_MS, FORM_TOKEN_MIN_AGE_MS, TOUCH_TOKEN_MAX_AGE_MS, issueFormToken, issueTouchToken, verifyFormToken, verifyTouchToken,
} from "@/lib/marketing/tokens";
import { buildCsvSafe, csvCell } from "@/lib/marketing/csv";
import { consentConfigSchema, formFieldsSchema, parseFormDefinition, validateSubmission } from "@/lib/marketing/form-schema";
import { collectLandingTexts, landingDisclosures, parseLandingSections } from "@/lib/marketing/landing-schema";
import { assignVariant, evaluateExperiment, twoProportionTest } from "@/lib/marketing/experiments";
import { computeRoi, unitCost } from "@/lib/marketing/analytics";
import { assertNoSensitiveAdPayload, buildAdPlatformEvent, isSendableEventType } from "@/lib/marketing/providers/ad-event";
import { extractClickId, extractUtm, hashClickId, referrerHostOf, sanitizeUtm } from "@/lib/marketing/attribution";
import { sanitizeHttpsUrl } from "@/lib/marketing/url";
import { remainingBudgetMinor } from "@/lib/marketing/budget-service";
import { MARKETING_AI_LIMITATIONS, PHRASE_LIBRARY, buildMarketingAssist } from "@/lib/ai/analysis/marketing-assistant";
import { checkText } from "@/lib/ai/safety";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-marketing-tests-0123456789";
});

describe("campaign / content-version state machines", () => {
  it("only the listed campaign transitions are allowed, and ARCHIVED is terminal", () => {
    expect(canTransitionCampaign("DRAFT", "IN_REVIEW")).toBe(true);
    expect(canTransitionCampaign("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionCampaign("DRAFT", "APPROVED")).toBe(false); // cannot skip review
    expect(canTransitionCampaign("IN_REVIEW", "ACTIVE")).toBe(false);
    expect(canTransitionCampaign("COMPLETED", "ACTIVE")).toBe(false);
    expect(CAMPAIGN_TRANSITIONS.ARCHIVED).toEqual([]);
    for (const s of Object.values(MarketingCampaignStatus)) expect(CAMPAIGN_TRANSITIONS[s]).toBeDefined();
  });
  it("a draft can only reach ACTIVE through review and approval", () => {
    const reach = (from: MarketingCampaignStatus, skip: MarketingCampaignStatus[]) => {
      const seen = new Set<MarketingCampaignStatus>([from]);
      const q = [from];
      while (q.length) {
        const cur = q.shift() as MarketingCampaignStatus;
        for (const n of CAMPAIGN_TRANSITIONS[cur]) if (!skip.includes(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
      return seen;
    };
    expect(reach("DRAFT", ["IN_REVIEW"]).has("ACTIVE")).toBe(false);
    expect(reach("DRAFT", ["APPROVED"]).has("ACTIVE")).toBe(false);
  });
  it("content versions go DRAFT → REVIEW → APPROVED and approved content is never edited back", () => {
    expect(canTransitionContentVersion("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionContentVersion("REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionContentVersion("APPROVED", "DRAFT")).toBe(false);
    expect(canTransitionContentVersion("APPROVED", "SUPERSEDED")).toBe(true);
    for (const s of Object.values(ContentVersionStatus)) expect(CONTENT_VERSION_TRANSITIONS[s]).toBeDefined();
  });
});

describe("content policy", () => {
  const scan = (text: string, extra: Partial<Parameters<typeof scanMarketingContent>[0]> = {}) => scanMarketingContent({ texts: [{ field: "t", text }], ...extra });
  const rules = (text: string) => scan(text).findings.map((f) => f.rule);

  it("passes neutral, process-focused wording", () => {
    expect(scan("A private, verification-focused way to begin your search.").pass).toBe(true);
  });
  it.each([
    ["guaranteed outcome", "We guarantee you will find a spouse in 30 days"],
    ["perfect match claim", "Meet your perfect match today"],
    ["100% claim", "100% success rate"],
    ["religion", "Only for Sunni families"],
    ["caste", "Rishtay for Syed caste"],
    ["income", "Income above 200k only"],
    ["browse implication", "Browse profiles and swipe to match"],
  ])("blocks %s", (_label, text) => {
    expect(scan(text).pass).toBe(false);
  });
  it("blocks Roman-Urdu and Urdu-script guarantees", () => {
    expect(scan("Rishta ki guarantee, 100% pakka").pass).toBe(false);
    expect(scan("رشتے کی ضمانت").pass).toBe(false);
  });
  it("blocks emails, phone numbers, external links and testimonials", () => {
    expect(rules("Write to someone@example.com")).toContain("PII_OR_PROFILE_DISCLOSURE");
    expect(rules("Call 0300 1234567 now")).toContain("PII_OR_PROFILE_DISCLOSURE");
    expect(rules("See https://evil.example/x")).toContain("PII_OR_PROFILE_DISCLOSURE");
    expect(scan("Read our happy couple success story").pass).toBe(false);
  });
  it("allows links only to allow-listed hosts", () => {
    expect(scan("See https://lifepartnerpro.vercel.app/privacy", { allowedUrlHosts: ["lifepartnerpro.vercel.app"] }).pass).toBe(true);
  });
  it("scans targeting keys and values, and blocks a minimum age below 18", () => {
    expect(scan("ok", { targeting: { interests: ["religion:sunni"] } }).pass).toBe(false);
    expect(scan("ok", { targeting: { caste: "x" } }).pass).toBe(false);
    expect(scan("ok", { targeting: { ageMin: 16 } }).findings.map((f) => f.rule)).toContain("MINOR_TARGETING");
    expect(scan("ok", { targeting: { ageMin: 21, cities: ["Lahore"] } }).pass).toBe(true);
  });
  it("requires privacy notice, consent block and disclaimer when asked", () => {
    const r = scan("ok", { requiredDisclosures: { privacyNotice: false, consentBlock: false, disclaimer: false } });
    expect(r.findings.filter((f) => f.rule === "MISSING_REQUIRED_DISCLOSURE")).toHaveLength(3);
    expect(scan("ok", { requiredDisclosures: { privacyNotice: true, consentBlock: true, disclaimer: true } }).pass).toBe(true);
  });
  it("states plainly that it is a lexical check, not legal review", () => {
    expect(scan("ok").disclaimer).toMatch(/not a legal review/i);
  });
  it("a scan is only valid for the exact content it scanned", () => {
    expect(assertScanFresh("abc", "abc")).toBe(true);
    expect(assertScanFresh("abc", "abd")).toBe(false);
    expect(assertScanFresh(null, "abd")).toBe(false);
    expect(assertScanFresh("abc", undefined)).toBe(false);
  });
});

describe("phone / email normalisation and hashing", () => {
  it("normalises Pakistani numbers to one E.164 form", () => {
    for (const v of ["03001234567", "0300-1234567", "+92 300 1234567", "00923001234567", "3001234567", "(0300) 123 4567"]) {
      expect(normalizePhoneE164(v), v).toBe("+923001234567");
    }
  });
  it("rejects implausible numbers", () => {
    expect(normalizePhoneE164("123")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164("1".repeat(20))).toBeNull();
  });
  it("normalises and validates email", () => {
    expect(normalizeEmail("  Foo@Example.COM ")).toBe("foo@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });
  it("the same destination typed differently hashes identically, and hashes are not the raw value", () => {
    const a = computeContactHashes({ phone: "0300 1234567", email: "A@x.com" });
    const b = computeContactHashes({ phone: "+923001234567", email: "a@X.com" });
    expect(a.phoneHash).toBe(b.phoneHash);
    expect(a.emailHash).toBe(b.emailHash);
    expect(a.phoneHash).not.toContain("3001234567");
    expect(a.suppressionHashes.length).toBeGreaterThan(2);
    expect(lastTenDigits("+923001234567")).toBe("3001234567");
  });
});

describe("signed public tokens", () => {
  const form = { formId: "f1", formVersionId: "v1" };
  it("a fresh form token is rejected as too fast, accepted in the window, rejected when expired", () => {
    const now = Date.now();
    const t = issueFormToken({ ...form, now });
    expect(verifyFormToken(t, form, now + 500)).toEqual({ valid: false, reason: "TOO_FAST" });
    const ok = verifyFormToken(t, form, now + FORM_TOKEN_MIN_AGE_MS + 1);
    expect(ok.valid).toBe(true);
    expect(verifyFormToken(t, form, now + FORM_TOKEN_MAX_AGE_MS + 1000)).toEqual({ valid: false, reason: "EXPIRED" });
  });
  it("each token has its own nonce (the idempotency key)", () => {
    const a = issueFormToken(form);
    const b = issueFormToken(form);
    expect(a).not.toBe(b);
  });
  it("rejects tampering, wrong form, wrong version and garbage", () => {
    const now = Date.now();
    const t = issueFormToken({ ...form, now });
    const later = now + 10_000;
    const parts = t.split(".");
    const forged = [...parts.slice(0, 1), "OTHER", ...parts.slice(2)].join(".");
    expect(verifyFormToken(forged, form, later)).toMatchObject({ valid: false });
    expect(verifyFormToken(t.slice(0, -2) + "xx", form, later)).toEqual({ valid: false, reason: "BAD_SIGNATURE" });
    expect(verifyFormToken(t, { formId: "other" }, later)).toEqual({ valid: false, reason: "MISMATCH" });
    expect(verifyFormToken(t, { formId: "f1", formVersionId: "v2" }, later)).toEqual({ valid: false, reason: "MISMATCH" });
    expect(verifyFormToken("nonsense", form, later)).toEqual({ valid: false, reason: "MALFORMED" });
  });
  it("touch tokens round-trip, expire after 30 days and reject edited claims", () => {
    const issuedAt = Date.now();
    const t = issueTouchToken({ campaignId: "c1", pageId: "p1", pageVersionId: "pv1", utm: { source: "meta" }, issuedAt });
    const ok = verifyTouchToken(t, issuedAt + 1000);
    expect(ok.valid && ok.claims.campaignId).toBe("c1");
    expect(verifyTouchToken(t, issuedAt + TOUCH_TOKEN_MAX_AGE_MS + 1)).toEqual({ valid: false, reason: "EXPIRED" });
    const [p, body, sig] = t.split(".");
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), campaignId: "evil" })).toString("base64url");
    expect(verifyTouchToken([p, edited, sig].join("."), issuedAt + 1000)).toEqual({ valid: false, reason: "BAD_SIGNATURE" });
    expect(verifyTouchToken(undefined)).toMatchObject({ valid: false });
    expect(verifyTouchToken("a.b.c")).toMatchObject({ valid: false });
  });
  it("a form token is not accepted as a touch token (and vice versa)", () => {
    expect(verifyTouchToken(issueFormToken(form))).toMatchObject({ valid: false });
    expect(verifyFormToken(issueTouchToken({ campaignId: null, pageId: null, pageVersionId: null, utm: {} }), form, Date.now() + 10_000)).toMatchObject({ valid: false });
  });
});

describe("attribution inputs", () => {
  it("only well-formed UTM values survive", () => {
    expect(sanitizeUtm("meta_ads-2024")).toBe("meta_ads-2024");
    expect(sanitizeUtm("<script>")).toBeUndefined();
    expect(sanitizeUtm("a".repeat(101))).toBeUndefined();
    expect(extractUtm(new URLSearchParams("utm_source=meta&utm_medium=%3Cb%3E"))).toEqual({ source: "meta", medium: undefined, campaign: undefined, content: undefined, term: undefined });
  });
  it("click ids are stored only as hashes", () => {
    const c = extractClickId(new URLSearchParams("fbclid=ABC123xyz"));
    expect(c?.type).toBe("fbclid");
    expect(c?.hash).toBe(hashClickId("fbclid", "ABC123xyz"));
    expect(JSON.stringify(c)).not.toContain("ABC123xyz");
    expect(extractClickId(new URLSearchParams("fbclid=bad value!"))).toBeNull();
  });
  it("only the host of a referrer is kept", () => {
    expect(referrerHostOf("https://www.facebook.com/some/path?token=secret")).toBe("www.facebook.com");
    expect(referrerHostOf("not a url")).toBeUndefined();
  });
  it("seo URLs must be https on an allowed host", () => {
    const hosts = ["lifepartnerpro.vercel.app"];
    expect(sanitizeHttpsUrl("https://lifepartnerpro.vercel.app/lp/x", hosts)).toContain("lifepartnerpro.vercel.app");
    expect(sanitizeHttpsUrl("http://lifepartnerpro.vercel.app/", hosts)).toBeNull();
    expect(sanitizeHttpsUrl("https://evil.example/", hosts)).toBeNull();
    expect(sanitizeHttpsUrl("https://user:pw@lifepartnerpro.vercel.app/", hosts)).toBeNull();
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formulas and quotes every cell", () => {
    for (const v of ["=cmd|' /C calc'!A0", "+1+1", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(v).startsWith(`"'`)).toBe(true);
    expect(csvCell('say "hi"\nnow')).toBe('"say ""hi"" now"');
    expect(csvCell(null)).toBe('""');
    expect(buildCsvSafe(["a", "b"], [["=1", "ok"]])).toBe('"a","b"\r\n"\'=1","ok"');
  });
});

describe("lead form definitions", () => {
  const fields = [
    { key: "fullName", label: "Full name", required: true },
    { key: "phone", label: "Mobile", required: true },
  ];
  const consent = { inquiryContact: { required: true, text: "I agree to be contacted about my inquiry." } };

  it("accepts a minimal valid definition and defaults optional consents to off and unticked", () => {
    const d = parseFormDefinition(fields, consent);
    expect(d.consentConfig.marketingUpdates).toMatchObject({ enabled: false, defaultChecked: false });
    expect(d.consentConfig.whatsapp.defaultChecked).toBe(false);
  });
  it("refuses sensitive fields by key or by label", () => {
    expect(formFieldsSchema.safeParse([...fields, { key: "city", label: "Your religion" }]).success).toBe(false);
    expect(formFieldsSchema.safeParse([...fields, { key: "religion", label: "x" }]).success).toBe(false);
    expect(formFieldsSchema.safeParse([...fields, { key: "city", label: "Monthly income" }]).success).toBe(false);
  });
  it("needs a name and one way to reach the person", () => {
    expect(formFieldsSchema.safeParse([{ key: "fullName", label: "Name", required: true }, { key: "city", label: "City" }]).success).toBe(false);
    expect(formFieldsSchema.safeParse([{ key: "phone", label: "Mobile", required: true }, { key: "city", label: "City" }]).success).toBe(false);
  });
  it("cannot pre-tick marketing or WhatsApp consent", () => {
    expect(consentConfigSchema.safeParse({ ...consent, marketingUpdates: { enabled: true, text: "Send me updates please", defaultChecked: true } }).success).toBe(false);
    expect(consentConfigSchema.safeParse({ ...consent, whatsapp: { enabled: true, defaultChecked: true, text: "WhatsApp me please ok" } }).success).toBe(false);
  });
  it("optional consent needs its own wording", () => {
    expect(consentConfigSchema.safeParse({ ...consent, marketingUpdates: { enabled: true } }).success).toBe(false);
  });
  it("validates a submission against the pinned definition and drops unknown keys", () => {
    const def = parseFormDefinition(fields, consent).fields;
    const ok = validateSubmission(def, { fullName: " Ali ", phone: "0300 1234567", isAdmin: true, religion: "x" });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value).toEqual({ fullName: "Ali", phone: "0300 1234567" });
      expect(Object.keys(ok.value)).not.toContain("isAdmin");
    }
    expect(validateSubmission(def, { fullName: "Ali" }).ok).toBe(false);
    expect(validateSubmission(def, { fullName: "<b>Ali</b>", phone: "03001234567" }).ok).toBe(false);
    expect(validateSubmission(def, { fullName: "Ali", phone: "12" }).ok).toBe(false);
    expect(validateSubmission(def, { fullName: "x".repeat(200), phone: "03001234567" }).ok).toBe(false);
  });
});

describe("landing page content", () => {
  const base = [
    { id: "hero", type: "HERO", heading: "A private way to begin", subtitle: "Share a few details" },
    { id: "form", type: "FORM_EMBED", formId: "form1" },
    { id: "disc", type: "DISCLAIMER", body: "No outcome is guaranteed." },
  ];
  it("accepts structured sections and reports which disclosures are present", () => {
    const s = parseLandingSections(base);
    expect(s).toHaveLength(3);
    expect(landingDisclosures(s)).toEqual({ privacyNotice: true, consentBlock: true, disclaimer: true });
    expect(landingDisclosures(parseLandingSections([base[0]]))).toEqual({ privacyNotice: false, consentBlock: false, disclaimer: false });
  });
  it("has no raw-HTML channel: markup, javascript: links and unknown section types are rejected", () => {
    expect(() => parseLandingSections([{ id: "a", type: "TEXT", heading: "x", body: "<img src=x onerror=alert(1)>" }])).toThrow();
    expect(() => parseLandingSections([{ id: "a", type: "CTA", heading: "x", ctaLabel: "Go", ctaHref: "javascript:alert(1)" }])).toThrow();
    expect(() => parseLandingSections([{ id: "a", type: "CTA", heading: "x", ctaLabel: "Go", ctaHref: "//evil.example" }])).toThrow();
    expect(() => parseLandingSections([{ id: "a", type: "HTML", html: "<b>x</b>" }])).toThrow();
    expect(() => parseLandingSections([])).toThrow();
  });
  it("is size-capped", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, type: "TEXT", heading: "h", body: "x".repeat(1500) }));
    expect(() => parseLandingSections(big)).not.toThrow(); // 20 × 1.5k stays under the cap
    expect(() => parseLandingSections([...big, ...big])).toThrow();
  });
  it("collects every text field (including list items) for the content policy", () => {
    const texts = collectLandingTexts(parseLandingSections([{ id: "f", type: "FAQ", heading: "Questions", items: [{ q: "Q1", a: "We guarantee a match" }] }]));
    expect(texts.map((t) => t.text)).toContain("We guarantee a match");
    expect(scanMarketingContent({ texts }).pass).toBe(false);
  });
});

describe("experiments", () => {
  const variants = [{ key: "control", label: "A", trafficPct: 50 }, { key: "b", label: "B", trafficPct: 50 }];
  it("variant assignment is deterministic per subject and roughly follows the split", () => {
    expect(assignVariant("e1", variants, "s1")).toBe(assignVariant("e1", variants, "s1"));
    let b = 0;
    for (let i = 0; i < 2000; i++) if (assignVariant("e1", variants, `s${i}`) === "b") b++;
    expect(b).toBeGreaterThan(850);
    expect(b).toBeLessThan(1150);
  });
  it("says INSUFFICIENT_DATA below the minimum sample and reports no rate", () => {
    const r = evaluateExperiment([{ key: "control", label: "A", exposures: 99, conversions: 50 }, { key: "b", label: "B", exposures: 500, conversions: 400 }], 100);
    expect(r.verdict.status).toBe("INSUFFICIENT_DATA");
    expect(r.results[0].ratePct).toBeNull();
  });
  it("detects a clear difference only with enough data, and never picks a winner for the team", () => {
    const sig = evaluateExperiment([{ key: "control", label: "A", exposures: 1000, conversions: 50 }, { key: "b", label: "B", exposures: 1000, conversions: 120 }], 100);
    expect(sig.verdict.status).toBe("SIGNIFICANT_DIFFERENCE");
    expect(sig.verdict.message).toMatch(/nothing is changed automatically/i);
    const none = evaluateExperiment([{ key: "control", label: "A", exposures: 200, conversions: 20 }, { key: "b", label: "B", exposures: 200, conversions: 21 }], 100);
    expect(none.verdict.status).toBe("NO_SIGNIFICANT_DIFFERENCE");
    expect(twoProportionTest(1, 0, 1, 5)).toBeNull();
  });
});

describe("analytics honesty", () => {
  it("ROI is withheld without verified spend, an attribution model and positive revenue", () => {
    const insufficient = { status: "INSUFFICIENT_DATA", message: "Insufficient verified data for ROI calculation." };
    expect(computeRoi({ spendVerified: false, spendMinor: 1000, attributionModel: "SINGLE_TOUCH", revenueMinor: 5000 })).toEqual(insufficient);
    expect(computeRoi({ spendVerified: true, spendMinor: 0, attributionModel: "SINGLE_TOUCH", revenueMinor: 5000 })).toEqual(insufficient);
    expect(computeRoi({ spendVerified: true, spendMinor: 1000, attributionModel: null, revenueMinor: 5000 })).toEqual(insufficient);
    expect(computeRoi({ spendVerified: true, spendMinor: 1000, attributionModel: "SINGLE_TOUCH", revenueMinor: null })).toEqual(insufficient);
    expect(computeRoi({ spendVerified: true, spendMinor: 1000, attributionModel: "SINGLE_TOUCH", revenueMinor: 0 })).toEqual(insufficient);
  });
  it("calculates ROI in integer percent only when everything is verified", () => {
    const r = computeRoi({ spendVerified: true, spendMinor: 10_000, attributionModel: "SINGLE_TOUCH", revenueMinor: 25_000 });
    expect(r).toMatchObject({ status: "CALCULATED", roiPct: 150 });
  });
  it("unit costs are null without a denominator and stay integer", () => {
    expect(unitCost(1000, 0)).toBeNull();
    expect(Number.isInteger(unitCost(1000, 3) as number)).toBe(true);
  });
  it("remaining budget is unknown (null) until spend is provider-verified", () => {
    expect(remainingBudgetMinor({ budgetTotalMinor: 100_000, spendVerified: false, spendVerifiedMinor: 0 })).toBeNull();
    expect(remainingBudgetMinor({ budgetTotalMinor: 100_000, spendVerified: true, spendVerifiedMinor: 30_000 })).toBe(70_000);
    expect(remainingBudgetMinor({ budgetTotalMinor: 100_000, spendVerified: true, spendVerifiedMinor: 130_000 })).toBe(0);
  });
});

describe("ad platform events never carry personal or sensitive data", () => {
  it("only four funnel events are sendable and progress events are not", () => {
    expect(isSendableEventType("LEAD_CREATED")).toBe(true);
    expect(isSendableEventType("PROFILE_COMPLETED" as never)).toBe(false);
    expect(buildAdPlatformEvent("PROFILE_COMPLETED" as never)).toBeNull();
  });
  it("the built event contains only the allowed vocabulary and a random id", () => {
    const e = buildAdPlatformEvent("LEAD_CREATED", { campaignRef: "LPP-MCAMP-000001" });
    expect(e).not.toBeNull();
    expect(Object.keys(e!).sort()).toEqual(["actionSource", "campaignRef", "eventId", "eventName", "eventTime"]);
    expect(e!.eventId).not.toContain("LEAD");
    expect(buildAdPlatformEvent("LEAD_CREATED", { campaignRef: "bad ref with spaces & symbols" })).not.toHaveProperty("campaignRef");
  });
  it("the recursive scan rejects sensitive keys and values wherever they are nested", () => {
    for (const bad of [
      { email: "a@b.co" }, { user_data: {} }, { a: { b: { phone: "1" } } }, { list: [{ religion: "x" }] }, { note: "x" }, { leadId: "x" },
      { custom: "reach me at someone@example.com" }, { custom: "call +92 300 1234567" }, { profile_id: "p" }, { ip: "1.2.3.4" },
    ]) expect(() => assertNoSensitiveAdPayload(bad), JSON.stringify(bad)).toThrow();
    expect(() => assertNoSensitiveAdPayload({ eventName: "Lead", eventTime: 1, eventId: "abc", actionSource: "website" })).not.toThrow();
  });
});

describe("marketing AI assistant (drafts only)", () => {
  it("every phrase in the library passes the marketing content policy and the AI safety check", () => {
    for (const lang of ["EN", "UR"] as const) {
      const lib = PHRASE_LIBRARY[lang];
      const all = [...lib.HEADLINES, ...lib.DESCRIPTIONS, ...lib.CTAS, ...lib.LANDING_INTRO, ...lib.FAQ.flatMap((f) => [f.q, f.a])];
      for (const t of all) {
        expect(scanMarketingContent({ texts: [{ field: "p", text: t }] }).pass, t).toBe(true);
        const c = checkText(t);
        expect(c.events, t).toEqual([]);
        expect(c.blocked, t).toBe(false);
        expect(c.text, t).toBe(t);
      }
    }
  });
  it("labels output for human review and states what it cannot do", () => {
    const p = buildMarketingAssist({ mode: "HEADLINES", language: "EN" });
    expect(JSON.stringify(p)).toContain("Human Review Required");
    expect(MARKETING_AI_LIMITATIONS.join(" ")).toMatch(/cannot launch campaigns, change budgets, spend money/i);
    expect((p.data as { suggestions?: string[] }).suggestions?.length).toBeGreaterThan(0);
  });
  it("summaries restate supplied aggregate numbers and never claim marriage outcomes", () => {
    const p = buildMarketingAssist({ mode: "CAMPAIGN_SUMMARY", summary: { campaignCode: "LPP-MCAMP-000001", status: "ACTIVE", leads: 10, registrations: 3, verified: 1 } });
    expect(p.summary).toMatch(/10 lead/);
    expect(p.summary).toMatch(/not match or marriage outcomes/i);
  });
  it("lead follow-up output is a draft and never claims to have been sent", () => {
    const p = buildMarketingAssist({ mode: "LEAD_FOLLOWUP", leadFirstName: "Ayesha" });
    expect(JSON.stringify(p).toLowerCase()).not.toMatch(/\bhas been sent\b|\bsent to\b/);
    expect(JSON.stringify(p)).toMatch(/not sent|draft/i);
  });
});
