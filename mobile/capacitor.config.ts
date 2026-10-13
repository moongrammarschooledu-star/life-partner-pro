import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Life Partner Pro mobile shell (STEP 37). The apps are a native wrapper that shows the website: the same sign-in, API and permissions, no second backend.
// Everything that differs between environments comes from the build environment (see MOBILE_ENVIRONMENT_VARIABLES.md); nothing secret belongs in this file.
//
//   APP_URL / NEXT_PUBLIC_APP_URL   the address of the website the app shows (https only)
//   ANDROID_PACKAGE_ID / IOS_BUNDLE_ID   store identifiers (once published they must never change)
//   MOBILE_ALLOWED_HOSTS            extra hosts the app may show, comma separated (the app host is always allowed)
//   MOBILE_APP_VERSION              marketing version, e.g. 1.0.0 (defaults to package.json)
//   MOBILE_BUILD_TYPE               "release" removes web debugging

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
const env = process.env;

const rawUrl = (env.APP_URL || env.NEXT_PUBLIC_APP_URL || "https://lifepartnerpro.vercel.app").trim();
const url = new URL(rawUrl);
if (url.protocol !== "https:") throw new Error("APP_URL must be an https address: the apps never load the site over an unencrypted connection.");

const extraHosts = (env.MOBILE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter((h) => /^[a-z0-9.-]+$/.test(h));

const version = (env.MOBILE_APP_VERSION || pkg.version).trim();
if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(version)) throw new Error("MOBILE_APP_VERSION must be a dotted number such as 1.0.0.");
const release = (env.MOBILE_BUILD_TYPE ?? "release").toLowerCase() === "release";

const config: CapacitorConfig = {
  appId: env.ANDROID_PACKAGE_ID || env.IOS_BUNDLE_ID || "com.lifepartnerpro.app",
  appName: "Life Partner Pro",
  // A tiny local page, shown only if the website cannot be reached (see www/offline.html). Nothing private is ever stored in the app.
  webDir: "www",
  server: {
    url: url.origin,
    cleartext: false,
    // The app may only show this site (and any host listed on purpose). Everything else opens in the phone's own browser.
    allowNavigation: [url.host, ...extraHosts],
    errorPath: "offline.html",
  },
  android: {
    appendUserAgent: `LPPApp/${version} (android)`,
    allowMixedContent: false,
    webContentsDebuggingEnabled: !release,
    // The release build must not be backed up to the cloud or debuggable; see android/app/src/main/AndroidManifest.xml.
  },
  ios: {
    appendUserAgent: `LPPApp/${version} (ios)`,
    contentInset: "automatic",
    limitsNavigationsToAppBoundDomains: false,
  },
  loggingBehavior: release ? "none" : "debug",
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
