import { NextResponse } from "next/server";
import { androidCertFingerprints, mobileIdentity } from "@/lib/mobile/config";

export const dynamic = "force-dynamic";

// Android App Links (STEP 37 §15): ties this website to the Android app. The certificate fingerprints are PUBLIC values (the SHA-256 of the signing key,
// including Play App Signing's key). Until they are configured the file is an empty list: it never claims a link that has not been set up.
export async function GET() {
  const fingerprints = androidCertFingerprints();
  const body = fingerprints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: mobileIdentity().androidPackageId, sha256_cert_fingerprints: fingerprints } }]
    : [];
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/json" } });
}