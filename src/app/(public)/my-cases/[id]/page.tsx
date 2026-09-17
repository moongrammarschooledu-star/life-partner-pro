"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Loader2, Send, Paperclip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface CaseDetail {
  id: string;
  caseNumber: string;
  type: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  responses: { id: string; body: string; createdAt: string; official: boolean }[];
  resolution: { summary: string; actionTaken: string | null; createdAt: string } | null;
}

export default function MyCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<CaseDetail | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function load() {
    fetch(`/api/my-cases/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setData)
      .catch(() => setData(null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function respond() {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/my-cases/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage("");
      show("Response submitted", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not submit response.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadEvidence() {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/my-cases/${id}/evidence`, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setFile(null);
      show("File uploaded", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not upload file.", "error");
    } finally {
      setUploading(false);
    }
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/my-cases" className="text-sm text-muted hover:text-foreground">&larr; Back to Help &amp; Support</Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted">{data.caseNumber}</p>
          <h1 className="font-heading text-2xl font-semibold">{data.subject}</h1>
          <p className="text-sm text-muted">{formatEnumLabel(data.type)} · {formatEnumLabel(data.category)} · Submitted {formatDateTime(data.createdAt)}</p>
        </div>
        <StatusBadge status={data.status} />
      </div>

      <Card className="mt-4">
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{data.description}</p>
        </CardContent>
      </Card>

      {data.resolution && (
        <Card className="mt-4">
          <CardContent>
            <p className="mb-1 text-sm font-medium">Resolution</p>
            <p className="text-sm">{data.resolution.summary}</p>
            {data.resolution.actionTaken && <p className="mt-1 text-sm text-muted">{data.resolution.actionTaken}</p>}
            <p className="mt-2 text-xs text-muted">{formatDateTime(data.resolution.createdAt)}</p>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">Updates</p>
          {data.responses.length === 0 ? (
            <p className="text-sm text-muted">No responses yet — our team will be in touch.</p>
          ) : (
            data.responses.map((r) => (
              <div key={r.id} className={`rounded-lg border p-3 text-sm ${r.official ? "border-primary/30 bg-primary/5" : "border-border"}`}>
                <p>{r.body}</p>
                <p className="mt-1 text-xs text-muted">{r.official ? "Life Partner Pro Team" : "You"} · {formatDateTime(r.createdAt)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {data.status === "WAITING_FOR_USER" && (
        <Card className="mt-4">
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">Our team has requested more information</p>
            <Textarea placeholder="Type your response…" value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-24" />
            <div className="flex items-center gap-2">
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
              <Button size="sm" variant="outline" onClick={uploadEvidence} disabled={!file || uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Attach
              </Button>
            </div>
            <Button onClick={respond} disabled={!message.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Response
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
