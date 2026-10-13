import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";
import { ALLOWED_LINKS } from "./deep-link";
import { SENSITIVE_PATH } from "./native";

// STEP 37 — checks on the Android / iOS project files that are committed under mobile/. They read source only (no Gradle, Xcode or device is needed), so they
// run in every normal test run and fail loudly if someone weakens the app's security configuration or commits a credential.

const ROOT = join(__dirname, "..", "..", "..");
const MOBILE = join(ROOT, "mobile");
const read = (p: string) => readFileSync(join(MOBILE, p), "utf8");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".gradle" || n === "build" || n === "Pods") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const files = existsSync(MOBILE) ? walk(MOBILE) : [];
const rel = (p: string) => relative(MOBILE, p).replace(/\\/g, "/");

describe("the mobile project exists and carries no credentials", () => {
  it("has the Android and iOS projects and the shell config", () => {
    for (const f of ["capacitor.config.ts", "package.json", "www/offline.html", "android/app/build.gradle", "ios/App/App/Info.plist", "android/app/src/main/AndroidManifest.xml"]) expect(existsSync(join(MOBILE, f)), f).toBe(true);
  });
  it("no signing key, certificate, provisioning profile, service account or Firebase file is committed", () => {
    const bad = files.filter((f) => /\.(keystore|jks|p12|p8|pem|mobileprovision|cer|aab|apk)$/i.test(f) || /(^|[\\/])(google-services\.json|GoogleService-Info\.plist|service-account.*\.json|local\.properties)$/i.test(f));
    expect(bad.map(rel)).toEqual([]);
  });
  it("no source file contains a private key block, a token or a hard-coded signing password", () => {
    for (const f of files.filter((p) => /\.(ts|js|mjs|json|gradle|xml|plist|swift|kt|java|html|properties|pro)$/i.test(p) && !p.includes("package-lock"))) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(src, rel(f)).not.toMatch(/\b(sk_live_|AKIA[0-9A-Z]{12,}|xox[abp]-|ghp_[A-Za-z0-9]{20,})/);
      expect(src, rel(f)).not.toMatch(/(storePassword|keyPassword)\s*['"][^'"$]{3,}['"]/);
    }
  });
  it("the shell's dependencies are the reviewed set (no analytics, ad or other SDK sneaks in)", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@aparajita/capacitor-biometric-auth",
      "@capacitor-community/privacy-screen",
      "@capacitor/android",
      "@capacitor/app",
      "@capacitor/core",
      "@capacitor/device",
      "@capacitor/ios",
      "@capacitor/preferences",
      "@capacitor/push-notifications",
    ]);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(["@capacitor/cli", "typescript"]);
  });
});

describe("shell configuration", () => {
  const cfg = () => read("capacitor.config.ts");
  it("loads the website over https only, and may show only the site's own host", () => {
    expect(cfg()).toMatch(/protocol !== "https:"/);
    expect(cfg()).toMatch(/cleartext: false/);
    expect(cfg()).toMatch(/allowNavigation: \[url\.host, \.\.\.extraHosts\]/);
    expect(cfg()).not.toMatch(/cleartext: true|allowMixedContent: true|allowNavigation: \[\s*["']\*["']/);
  });
  it("web debugging and logging are off in a release build, and the apps identify themselves with their version", () => {
    expect(cfg()).toMatch(/webContentsDebuggingEnabled: !release/);
    expect(cfg()).toMatch(/loggingBehavior: release \? "none" : "debug"/);
    expect(cfg()).toMatch(/LPPApp\/\$\{version\} \(android\)/);
    expect(cfg()).toMatch(/LPPApp\/\$\{version\} \(ios\)/);
  });
  it("the offline page makes no network request and promises nothing private", () => {
    const html = read("www/offline.html");
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).toContain("Some private account features are temporarily unavailable");
  });
});

describe("Android hardening", () => {
  const manifest = () => read("android/app/src/main/AndroidManifest.xml");
  it("is not backed up, not debuggable, no plain-text traffic, with a network security config", () => {
    const m = manifest();
    expect(m).toMatch(/android:allowBackup="false"/);
    expect(m).toMatch(/android:usesCleartextTraffic="false"/);
    expect(m).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/);
    expect(m).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
    expect(m).not.toMatch(/android:debuggable="true"/);
    expect(read("android/app/src/main/res/xml/network_security_config.xml")).not.toMatch(/cleartextTrafficPermitted="true"|certificates src="user"/);
  });
  it("exports one component only (the launch activity) and asks for the two permissions it needs", () => {
    const m = manifest();
    expect([...m.matchAll(/android:exported="true"/g)]).toHaveLength(1);
    expect(m).toMatch(/android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
    expect([...m.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((x) => x[1]).sort()).toEqual(["android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS"]);
    expect(m).not.toMatch(/ACCESS_(FINE|COARSE)_LOCATION|READ_CONTACTS|RECORD_AUDIO|BLUETOOTH|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|CAMERA/);
  });
  it("the verified App Links list exactly the approved routes (kept in step with ALLOWED_LINKS)", () => {
    const m = manifest();
    const exact = new Set([...m.matchAll(/<data android:path="([^"]+)"/g)].map((x) => x[1]));
    const prefixes = new Set([...m.matchAll(/<data android:pathPrefix="([^"]+)"/g)].map((x) => x[1]));
    expect(m).toMatch(/android:autoVerify="true"/);
    expect(m).toMatch(/android:host="\$\{appHost\}"/);
    expect(m).toMatch(/android:scheme="https"/);
    expect(m).not.toMatch(/android:scheme="(http|lpp|lifepartnerpro)"/);
    const expectedExact = new Set(ALLOWED_LINKS.filter((l) => !l.pattern.endsWith("/:id")).map((l) => l.pattern));
    const expectedPrefix = new Set(ALLOWED_LINKS.filter((l) => l.pattern.endsWith("/:id")).map((l) => `${l.pattern.slice(0, -3)}`));
    expect([...exact].sort()).toEqual([...expectedExact].sort());
    expect([...prefixes].sort()).toEqual([...expectedPrefix].sort());
  });
  it("the release build is shrunk, never debuggable, signed only from the environment, and fails loudly when a store build has no key", () => {
    const g = read("android/app/build.gradle");
    expect(g).toMatch(/release \{[\s\S]*?debuggable false[\s\S]*?minifyEnabled true[\s\S]*?shrinkResources true/);
    expect(g).toMatch(/LPP_KEYSTORE_PATH/);
    expect(g).toMatch(/LPP_REQUIRE_SIGNING/);
    expect(g).toMatch(/applicationIdSuffix '\.debug'/);
    expect(g).not.toMatch(/(storePassword|keyPassword|keyAlias)\s*['"]/);
    expect(g).toMatch(/google-services\.json/);
  });
  it("backup rules exclude everything, and the shrinker keeps the web view bridge", () => {
    const r = read("android/app/src/main/res/xml/data_extraction_rules.xml");
    for (const d of ["root", "file", "database", "sharedpref", "external"]) expect(r).toContain(`domain="${d}"`);
    expect(read("android/app/proguard-rules.pro")).toMatch(/JavascriptInterface/);
  });
});

describe("iOS hardening", () => {
  const plist = () => read("ios/App/App/Info.plist");
  it("allows no arbitrary network loads, explains every permission it asks for, and runs in the background only for notifications", () => {
    const p = plist();
    expect(p).toMatch(/NSAllowsArbitraryLoads<\/key>\s*<false\/>/);
    for (const k of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSFaceIDUsageDescription"]) expect(p, k).toContain(k);
    expect(p).not.toMatch(/NSLocation|NSContactsUsageDescription|NSMicrophoneUsageDescription|NSBluetooth/);
    expect(p).toMatch(/UIBackgroundModes<\/key>\s*<array>\s*<string>remote-notification<\/string>\s*<\/array>/);
    expect(p).toMatch(/<string>arm64<\/string>/);
    expect(p).not.toMatch(/CFBundleURLTypes/); // links are https Universal Links only: no custom URL scheme that any app could claim
  });
  it("has push and associated-domain entitlements for the site's host", () => {
    const e = read("ios/App/App/App.entitlements");
    expect(e).toContain("aps-environment");
    expect(e).toMatch(/applinks:[a-z0-9.-]+/);
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toMatch(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/);
  });
  it("forwards the push token to Capacitor and does not log it", () => {
    const d = read("ios/App/App/AppDelegate.swift");
    expect(d).toContain("capacitorDidRegisterForRemoteNotifications");
    expect(d).not.toMatch(/print\(|NSLog\(/);
  });
});

describe("the CI workflow (kept in mobile/ci; copied to .github/workflows by the owner)", () => {
  const wf = readFileSync(join(ROOT, "mobile", "ci", "mobile.yml"), "utf8");
  it("never prints a secret and passes each one only through an environment variable", () => {
    for (const line of wf.split("\n")) {
      if (/secrets\./.test(line)) expect(line, line).toMatch(/^\s+[A-Z_0-9]+: \$\{\{ secrets\.[A-Z_0-9]+ \}\}\s*$/);
      if (/\b(echo|printf)\b/.test(line)) expect(line, line).not.toMatch(/secrets\.|PASSWORD|_BASE64"?\s*\|\s*$/);
    }
    expect(wf).not.toMatch(/set -x|--verbose/);
  });
  it("builds the Android bundle, compiles iOS without signing, and publishes nothing by itself", () => {
    expect(wf).toContain("bundleRelease");
    expect(wf).toContain("CODE_SIGNING_ALLOWED=NO");
    expect(wf).not.toMatch(/upload-google-play|altool|app-store-connect-api|fastlane/);
    expect(wf).toMatch(/permissions:\s*\n\s+contents: read/);
  });
  it("removes the key material at the end of each signing job", () => {
    expect((wf.match(/Remove the key material/g) ?? []).length).toBe(2);
  });
});

describe("screens hidden from screenshots", () => {
  it("cover documents, proposals and verification, and nothing public", () => {
    for (const p of ["/dashboard/documents", "/dashboard/proposals/LPP-RP-000001", "/my-verification", "/my-proposals", "/family/documents"]) expect(SENSITIVE_PATH.test(p), p).toBe(true);
    for (const p of ["/", "/login", "/pricing", "/dashboard", "/account-settings"]) expect(SENSITIVE_PATH.test(p), p).toBe(false);
  });
});
