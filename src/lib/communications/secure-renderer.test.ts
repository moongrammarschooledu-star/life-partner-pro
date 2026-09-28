import { describe, it, expect } from "vitest";
import { COMMUNICATION_VARIABLES, TemplateRenderError, containsProtectedString, escapeHtml, renderTemplate, sanitizeUrl, sanitizeValue, toHtmlEmail, validateTemplateText } from "@/lib/communications/secure-renderer";

const HOSTS = ["lifepartnerpro.example"];
const render = (body: string, values: Record<string, string> = { firstName: "Ayesha" }, extra: Partial<Parameters<typeof renderTemplate>[0]> = {}) => renderTemplate({ body, values, hosts: HOSTS, ...extra });

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof TemplateRenderError ? error.code : "OTHER";
  }
}

describe("SecureTemplateRenderer", () => {
  it("renders whitelisted variables and reports which were used", () => {
    const out = render("Hello {{firstName}}, your proposal {{proposalId}} is ready.", { firstName: "Ayesha", proposalId: "PRP-1" });
    expect(out.text).toBe("Hello Ayesha, your proposal PRP-1 is ready.");
    expect(out.usedVariables.sort()).toEqual(["firstName", "proposalId"]);
  });

  it("rejects unknown variables instead of silently dropping them", () => {
    expect(code(() => render("Hi {{lastName}}"))).toBe("UNKNOWN_VARIABLE");
  });

  it.each(["phone", "mobileNumber", "whatsappNumber", "email", "password", "otp", "adminNote", "riskScore", "internalNote", "cnic", "income", "privateAddress", "token", "secret"])("never allows the variable {{%s}} even if a caller whitelists it", (name) => {
    expect(code(() => renderTemplate({ body: `x {{${name}}}`, values: { [name]: "v" }, allowed: [name], hosts: HOSTS }))).toBe("FORBIDDEN_VARIABLE");
  });

  it.each(["{{{firstName}}}", "{% if x %}", "${process.env.SECRET}", "<%= x %>", "{{ a.b }}", "{{#each x}}", "{{constructor}}", "{{__proto__}}", "<script>alert(1)</script>", "javascript:alert(1)", "<img onerror=x>"])("rejects template-injection syntax: %s", (text) => {
    expect(code(() => render(text))).toBe("INJECTION");
  });

  it("fails when a required value is missing rather than sending a hole", () => {
    expect(code(() => render("Hi {{firstName}}", {}))).toBe("MISSING_VALUE");
  });

  it("does not re-interpret template syntax inside a substituted value", () => {
    const out = render("Hi {{firstName}}", { firstName: "{{profileId}}" });
    expect(out.text).toBe("Hi {{profileId}}"); // single pass: the value is data, never re-rendered
  });

  it("strips control characters and caps value length (header / log injection)", () => {
    expect(sanitizeValue("Ali\r\nBcc: evil@x.com")).toBe("Ali Bcc: evil@x.com");
    expect(sanitizeValue("a".repeat(500)).length).toBe(120);
  });

  it("escapes HTML in the html form and only links allow-listed https URLs", () => {
    expect(escapeHtml(`<b onclick="x">&'</b>`)).toBe("&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;");
    const html = toHtmlEmail("Hi <script>alert(1)</script>\n\nhttps://evil.example/x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="https://evil.example');
  });

  it("allows only https links on an allow-listed host and blocks SSRF-style targets", () => {
    expect(sanitizeUrl("https://lifepartnerpro.example/dashboard", HOSTS)).toContain("lifepartnerpro.example");
    for (const bad of ["http://lifepartnerpro.example/x", "https://evil.example/x", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://10.0.0.1/x", "https://user:pw@lifepartnerpro.example/x", "javascript:alert(1)", "not a url"]) {
      expect(sanitizeUrl(bad, HOSTS), bad).toBeNull();
    }
    expect(code(() => render("Open https://evil.example/login now"))).toBe("BAD_URL");
    expect(() => render("Open https://lifepartnerpro.example/dashboard now")).not.toThrow();
  });

  it("refuses to render a message that would disclose protected contact details", () => {
    const protectedStrings = ["+92 300 1234567", "other@example.com"];
    expect(code(() => render("Call 0092-300-1234567", {}, { protectedStrings }))).toBe("PROTECTED_DATA"); // same digits, different formatting
    expect(code(() => render("Call 0300 7654321", {}, { protectedStrings }))).toBeNull();
    expect(code(() => render("Reach them at +92-300-1234567", {}, { protectedStrings }))).toBe("PROTECTED_DATA");
    expect(code(() => render("Mail OTHER@example.com", {}, { protectedStrings }))).toBe("PROTECTED_DATA");
    expect(containsProtectedString("nothing here", ["+92 300 1234567"])).toBe(false);
    expect(containsProtectedString("abc", ["ab"])).toBe(false); // too short to be a meaningful secret
  });

  it("validates template text for creation-time checks without values", () => {
    expect(validateTemplateText("Hi {{firstName}}", COMMUNICATION_VARIABLES)).toEqual({ ok: true, variables: ["firstName"] });
    expect(validateTemplateText("Hi {{nope}}", COMMUNICATION_VARIABLES).ok).toBe(false);
    expect(validateTemplateText("Hi {{firstName}", COMMUNICATION_VARIABLES).ok).toBe(false); // unbalanced braces are rejected, not guessed at
    expect(validateTemplateText("Hi { there }", COMMUNICATION_VARIABLES).ok).toBe(true); // single braces are plain text
    expect(validateTemplateText("Hi {{first name}}", COMMUNICATION_VARIABLES).ok).toBe(false);
  });

  it("rejects an empty rendered message", () => {
    expect(code(() => render("   "))).toBe("EMPTY");
  });
});
