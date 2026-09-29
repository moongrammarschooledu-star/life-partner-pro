import type { DocumentOcrProvider, OcrResult } from "@/lib/documents/providers/ocr-types";

// The default OCR provider: does nothing. No OCR vendor exists or has been approved/jurisdiction-checked
// for this deployment (spec §48's data-minimization and provider-approval requirements), and the spec
// itself insists OCR output is UNVERIFIED_INFORMATION pending human review — so a provider that never
// fabricates text is the honest default, not a missing feature. A real vendor can implement the same
// interface later, gated by documents.ocr.enabled plus its own configuration.
export class NoopOcrProvider implements DocumentOcrProvider {
  readonly key = "NOOP";

  async extractText(): Promise<OcrResult> {
    return { supported: false };
  }
  async detectDocumentType(): Promise<OcrResult> {
    return { supported: false };
  }
  async extractFields(): Promise<OcrResult> {
    return { supported: false };
  }
}

export const noopOcrProvider = new NoopOcrProvider();
