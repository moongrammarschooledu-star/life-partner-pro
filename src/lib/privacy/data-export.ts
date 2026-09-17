import { put } from "@vercel/blob";
import { randomUUID, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { issueStepUpToken, verifyStepUpToken } from "@/lib/step-up-token";
import { notifyDataExportReady } from "@/lib/notifications/events";

// Spec §20/§21 — "Download My Data". One profile's own data is small, so
// generation is synchronous (no queue). Encrypted like case evidence (own
// HKDF domain string for cryptographic domain separation); the "temporary
// secure download URL" is an HMAC-signed short-lived token (reusing
// step-up-token.ts's exact primitive), not a stored, sweep-cleaned token row.
const EXPORT_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

function exportKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-document-encryption", "data-export", 32));
}

function encrypt(plaintext: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", exportKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, ivBase64: iv.toString("base64"), authTagBase64: cipher.getAuthTag().toString("base64") };
}

function decrypt(ciphertext: Buffer, ivBase64: string, authTagBase64: string) {
  const decipher = createDecipheriv("aes-256-gcm", exportKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Never includes internal admin notes, security flags, other profiles'
// data, or other profiles' contact information (spec §20) — achieved by
// hand-picking fields, not a raw table dump.
export async function buildDataExportPayload(profileId: string) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      contact: true,
      education: true,
      profession: true,
      family: true,
      lifestyle: true,
      preference: true,
      photos: { select: { id: true, mimeType: true, isPrimary: true, createdAt: true } },
    },
  });
  if (!profile) throw new Error("Profile not found");

  const [consentHistory, proposalsAsA, proposalsAsB, cases] = await Promise.all([
    prisma.consentGrant.findMany({ where: { profileId }, orderBy: { recordedAt: "desc" } }),
    prisma.proposal.findMany({ where: { profileAId: profileId }, select: { proposalCode: true, status: true, createdAt: true } }),
    prisma.proposal.findMany({ where: { profileBId: profileId }, select: { proposalCode: true, status: true, createdAt: true } }),
    prisma.case.findMany({ where: { reporterProfileId: profileId }, select: { caseNumber: true, type: true, status: true, subject: true, createdAt: true } }),
  ]);

  return {
    profile: {
      profileCode: profile.profileCode,
      fullName: profile.fullName,
      gender: profile.gender,
      dateOfBirth: profile.dateOfBirth,
      maritalStatus: profile.maritalStatus,
      heightCm: profile.heightCm,
      city: profile.city,
      area: profile.area,
      country: profile.country,
      createdAt: profile.createdAt,
    },
    contact: profile.contact,
    education: profile.education,
    profession: profile.profession,
    family: profile.family,
    lifestyle: profile.lifestyle,
    partnerPreference: profile.preference,
    photos: profile.photos,
    consentHistory,
    proposals: [...proposalsAsA, ...proposalsAsB],
    cases,
  };
}

export async function createDataExport(profileId: string, format: "JSON" | "CSV" | "PDF" = "JSON") {
  const payload = await buildDataExportPayload(profileId);
  const json = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  const { ciphertext, ivBase64, authTagBase64 } = encrypt(json);

  const blob = await put(`data-exports/${randomUUID()}.enc`, ciphertext, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: true,
  });

  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
  const request = await prisma.dataExportRequest.create({
    data: { profileId, format, secureStorageReference: blob.url, ivBase64, authTagBase64, status: "READY", expiresAt },
  });

  await writeAudit({ action: "DATA_EXPORT_CREATED", targetProfileId: profileId, meta: { requestId: request.id, format } });
  await notifyDataExportReady(profileId);

  return request;
}

export function issueExportDownloadToken(requestId: string): string {
  return issueStepUpToken("data-export-download", requestId, EXPORT_TTL_MS);
}

export function verifyExportDownloadToken(token: string | null | undefined, requestId: string): boolean {
  return verifyStepUpToken(token, "data-export-download", requestId);
}

export async function readDataExport(request: { secureStorageReference: string; ivBase64: string; authTagBase64: string }): Promise<Buffer> {
  const res = await fetch(request.secureStorageReference);
  if (!res.ok) throw new Error(`Failed to fetch export from blob storage: ${res.status}`);
  const ciphertext = Buffer.from(await res.arrayBuffer());
  return decrypt(ciphertext, request.ivBase64, request.authTagBase64);
}
