// Applies the build-specific settings to the iOS project (STEP 37): bundle id, version, build number, Apple team and the Universal Links host.
// It is safe to run repeatedly. Nothing secret is involved: a bundle id, a version, a Team ID and a host name are all public.
//
//   IOS_BUNDLE_ID        default com.lifepartnerpro.app   (once published it must never change)
//   MOBILE_APP_VERSION   marketing version, e.g. 1.0.0
//   MOBILE_BUILD_NUMBER  a whole number that rises with every upload to App Store Connect
//   LPP_APP_HOST         the website host for Universal Links (default lifepartnerpro.vercel.app)
//   APPLE_TEAM_ID        10-character Apple Developer Team ID (optional locally; CI supplies it)
//
// Run from the mobile/ folder:  node scripts/configure-ios.mjs
import { readFileSync, writeFileSync } from "node:fs";

const env = process.env;
const bundle = (env.IOS_BUNDLE_ID || "com.lifepartnerpro.app").trim();
const version = (env.MOBILE_APP_VERSION || JSON.parse(readFileSync("package.json", "utf8")).version).trim();
const build = (env.MOBILE_BUILD_NUMBER || "1").trim();
const host = (env.LPP_APP_HOST || "lifepartnerpro.vercel.app").trim().toLowerCase();
const team = (env.APPLE_TEAM_ID || "").trim().toUpperCase();

if (!/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)+$/.test(bundle)) throw new Error("IOS_BUNDLE_ID is not a valid bundle identifier.");
if (!/^\d{1,5}(\.\d{1,5}){0,2}$/.test(version)) throw new Error("MOBILE_APP_VERSION must look like 1.0.0 (up to three parts) for iOS.");
if (!/^\d{1,9}$/.test(build)) throw new Error("MOBILE_BUILD_NUMBER must be a whole number.");
if (!/^[a-z0-9.-]+$/.test(host)) throw new Error("LPP_APP_HOST is not a valid host name.");
if (team && !/^[A-Z0-9]{10}$/.test(team)) throw new Error("APPLE_TEAM_ID must be 10 letters/digits.");

const pbxPath = "ios/App/App.xcodeproj/project.pbxproj";
let pbx = readFileSync(pbxPath, "utf8");
pbx = pbx.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${bundle};`);
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
// Point the app target at its entitlements file (push notifications + associated domains). Added once.
if (!pbx.includes("CODE_SIGN_ENTITLEMENTS")) pbx = pbx.replace(/(\t+)CODE_SIGN_STYLE = Automatic;/g, `$1CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n$1CODE_SIGN_STYLE = Automatic;`);
if (team) {
  pbx = pbx.replace(/\n\t+DEVELOPMENT_TEAM = [^;]+;/g, "");
  pbx = pbx.replace(/(\t+)CODE_SIGN_STYLE = Automatic;/g, `$1CODE_SIGN_STYLE = Automatic;\n$1DEVELOPMENT_TEAM = ${team};`);
}
writeFileSync(pbxPath, pbx);

// aps-environment is rewritten by Xcode from the provisioning profile when archiving for TestFlight / the App Store.
const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:${host}</string>
	</array>
</dict>
</plist>
`;
writeFileSync("ios/App/App/App.entitlements", entitlements);
console.log(`iOS project set to ${bundle} ${version} (${build}), links host ${host}${team ? `, team ${team}` : ""}.`);
