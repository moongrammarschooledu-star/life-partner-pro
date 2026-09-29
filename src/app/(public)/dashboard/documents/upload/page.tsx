"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, UploadCloud } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select, Checkbox } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

interface CategoryOption { key: string; label: string; types: { key: string; label: string; requiresExpiry: boolean }[] }

// The upload wizard (spec §21): select type -> upload -> preview -> security validation -> privacy
// notice -> consent -> submit -> confirmation.
function UploadWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const requestId = params.get("requestId") ?? undefined;
  const presetType = params.get("typeKey") ?? "";
  const { show } = useToast();

  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [typeKey, setTypeKey] = useState(presetType);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/my-documents/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCategories(j?.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  function pickFile(f: File | null) {
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!file || !typeKey || !consented) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("typeKey", typeKey);
      form.append("file", file);
      if (requestId) form.append("requestId", requestId);
      const res = await fetch("/api/my-documents", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(json.error ?? "Could not upload the document.", "error");
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Document received</h1>
        <p className="mt-2 text-sm text-muted">Thank you — your document was uploaded and will be reviewed. We&apos;ll let you know the outcome.</p>
        <Button className="mt-6" onClick={() => router.push("/dashboard/documents")}>Back to My Documents</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-16 sm:px-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/documents")}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <h1 className="mt-2 font-heading text-2xl font-semibold">Upload a document</h1>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <Field label="Document type" hint={requestId ? "Requested by our team." : undefined}>
            {categories === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Select value={typeKey} onChange={(e) => setTypeKey(e.target.value)} disabled={Boolean(presetType)}>
                <option value="">Select a document type…</option>
                {categories.map((c) => (
                  <optgroup key={c.key} label={c.label}>
                    {c.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>

          <Field label="File" hint="JPEG, PNG, WebP, PDF, DOCX or XLSX.">
            <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.xlsx" className="block w-full text-sm" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </Field>

          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" className="max-h-64 rounded-lg border border-border object-contain" />
          )}
          {file && !previewUrl && <p className="text-sm text-muted">{file.name} ({Math.round(file.size / 1024)} KB)</p>}

          <div className="rounded-lg bg-surface-muted p-3 text-xs text-muted">
            This document is stored encrypted and is private by default. It will be reviewed by our verification team, and will only ever be shared with anyone else if you explicitly approve it.
          </div>
          <Checkbox label="I consent to this document being stored and reviewed for the stated purpose." checked={consented} onChange={(e) => setConsented(e.target.checked)} />

          <Button onClick={submit} disabled={!file || !typeKey || !consented || busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Submit
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function UploadDocumentPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}>
      <UploadWizard />
    </Suspense>
  );
}
