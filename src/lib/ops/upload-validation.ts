// Upload hardening (spec §32/§33). Pure functions: detect the REAL file type
// from its leading bytes (never trust the client-declared MIME or extension),
// cross-check them, sanitise filenames and build a safe Content-Disposition.

export type DetectedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}

const EXTENSIONS: Record<DetectedType, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

// Extensions that must never appear anywhere in an uploaded filename
// (double-extension tricks such as "invoice.php.jpg").
const DANGEROUS_EXT = /\.(exe|dll|bat|cmd|com|scr|msi|sh|php\d?|phtml|jsp|asp|aspx|js|mjs|html?|svg|jar|vbs|ps1|py|rb|pl|cgi|htaccess)(\.|$)/i;

export type UploadCheck = { ok: true; detected: DetectedType } | { ok: false; error: string };

export function validateUpload(params: { buffer: Buffer; declaredMime: string; filename?: string | null; allowed: readonly DetectedType[]; maxBytes: number }): UploadCheck {
  const { buffer, declaredMime, filename, allowed, maxBytes } = params;
  if (buffer.length === 0) return { ok: false, error: "The file is empty." };
  if (buffer.length > maxBytes) return { ok: false, error: `The file is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).` };

  const detected = detectFileType(buffer);
  if (!detected || !allowed.includes(detected)) return { ok: false, error: "Unsupported or unrecognised file type." };
  const declared = declaredMime === "image/jpg" ? "image/jpeg" : declaredMime;
  if (declared !== detected) return { ok: false, error: "The file content does not match its declared type." };

  if (filename) {
    if (/[\0\\/]/.test(filename) || filename.includes("..")) return { ok: false, error: "The filename is not allowed." };
    if (DANGEROUS_EXT.test(filename)) return { ok: false, error: "The filename is not allowed." };
    const ext = filename.split(".").pop()?.toLowerCase();
    if (filename.includes(".") && ext && !EXTENSIONS[detected].includes(ext)) return { ok: false, error: "The file extension does not match its content." };
  }
  return { ok: true, detected };
}

// Stored/displayed name: no path, no control characters or quotes, bounded.
export function safeFilename(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"';<>|*?:]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned || "file";
}

// RFC 6266/5987: ASCII fallback with quotes/backslashes removed + UTF-8 form,
// so a crafted filename can never break out of the header value.
export function contentDisposition(filename: string, disposition: "inline" | "attachment" = "inline"): string {
  const safe = safeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export const MAX_IMAGE_PIXELS = 12_000; // per side
