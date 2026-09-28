import { decryptText, encryptText, isEncryptedToken } from "@/lib/communications/crypto";

// What is stored in CommunicationLog.messageBody. New rows keep the WHOLE outbound content (subject, text, html, positional
// provider-template parameters) as one AES-256-GCM envelope so a retry can rebuild the exact message without ever keeping
// plaintext at rest. Rows written before STEP 25 hold plain text and are read transparently.

export interface StoredContent {
  subject: string | null;
  text: string;
  html: string | null;
  params: string[];
}

export function packContent(content: StoredContent): string {
  return encryptText(JSON.stringify({ s: content.subject, t: content.text, h: content.html, p: content.params }));
}

export function unpackContent(body: string | null, encrypted: boolean): StoredContent | null {
  if (body === null) return null;
  if (!encrypted && !isEncryptedToken(body)) return { subject: null, text: body, html: null, params: [] };
  try {
    const j = JSON.parse(decryptText(body)) as { s?: string | null; t?: string; h?: string | null; p?: string[] };
    return { subject: j.s ?? null, text: j.t ?? "", html: j.h ?? null, params: Array.isArray(j.p) ? j.p : [] };
  } catch {
    return null; // tampered or key mismatch: treated as "content unavailable", never as an error the caller must handle
  }
}

// The text an authorised viewer may read (null when redacted by retention or unreadable).
export function readableText(body: string | null, encrypted: boolean, redactedAt: Date | null): string | null {
  if (redactedAt) return null;
  return unpackContent(body, encrypted)?.text ?? null;
}
