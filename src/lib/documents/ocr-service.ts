import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { noopOcrProvider } from "@/lib/documents/providers/noop-ocr-provider";
import type { DocumentOcrProvider, OcrResult } from "@/lib/documents/providers/ocr-types";
import { readDocumentBytes } from "@/lib/documents/storage";
import type { Document } from "@prisma/client";

// DocumentOCRService (spec §47/§48). Output is ALWAYS treated as UNVERIFIED_INFORMATION — nothing here
// is ever written to Document.verificationStatus directly, and no caller may treat an OCR result as a
// substitute for human review. Disabled by default (documents.ocr.enabled) since no OCR vendor is
// configured; see providers/noop-ocr-provider.ts.

function activeProvider(): DocumentOcrProvider {
  return noopOcrProvider; // the only slot filled today — a real vendor would be selected here once configured
}

async function runIfEnabled(document: Document, run: (provider: DocumentOcrProvider, bytes: Buffer) => Promise<OcrResult>): Promise<OcrResult> {
  if (!(await isFeatureEnabled("documents.ocr.enabled"))) return { supported: false };
  const provider = activeProvider();
  const bytes = await readDocumentBytes(document.secureStorageReference, document.ivBase64, document.authTagBase64);
  return run(provider, bytes);
}

export async function extractText(document: Document): Promise<OcrResult> {
  return runIfEnabled(document, (p, bytes) => p.extractText(bytes, document.mimeType));
}

export async function detectDocumentType(document: Document): Promise<OcrResult> {
  return runIfEnabled(document, (p, bytes) => p.detectDocumentType(bytes, document.mimeType));
}

export async function extractFields(document: Document): Promise<OcrResult> {
  return runIfEnabled(document, (p, bytes) => p.extractFields(bytes, document.mimeType));
}

export async function recordOcrResult(documentId: string, result: OcrResult): Promise<void> {
  if (!result.supported) return; // the NOOP provider never reaches here; a real provider's output lands below
  await prisma.documentOcrResult.create({
    data: { documentId, provider: activeProvider().key, extractedText: result.text?.slice(0, 20_000) ?? null, fields: JSON.stringify(result.fields ?? {}), detectedType: result.detectedType ?? null },
  });
}
