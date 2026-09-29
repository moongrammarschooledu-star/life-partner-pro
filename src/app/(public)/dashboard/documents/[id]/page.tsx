"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";

interface DocDetail {
  document: { id: string; documentCode: string; typeKey: string; status: string; verificationStatus: string; verificationReason: string | null; verificationNotes: string | null; originalFilename: string; sizeBytes: number; createdAt: string; expiresAt: string | null };
  versions: { version: number; createdAt: string; changeReason: string | null }[];
}

export default function MyDocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const [data, setData] = useState<DocDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/my-documents/${id}`).then(async (r) => {
      if (!r.ok) return setNotFound(true);
      setData(await r.json());
    });
  }, [id]);

  async function remove() {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    const r = await fetch(`/api/my-documents/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      show(j.error ?? "This document cannot be deleted from here.", "error");
      return;
    }
    router.push("/dashboard/documents");
  }

  if (notFound) return <div className="mx-auto max-w-lg px-4 py-16 text-sm text-muted sm:px-6">Document not found.</div>;
  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  const d = data.document;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-16 sm:px-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/documents")}><ArrowLeft className="h-4 w-4" /> Back</Button>
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-2xl font-semibold">{formatEnumLabel(d.typeKey)}</h1>
        <StatusBadge status={d.verificationStatus === "NOT_SUBMITTED" ? d.status : d.verificationStatus} />
      </div>
      <Card>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted">File:</span> {d.originalFilename} ({Math.round(d.sizeBytes / 1024)} KB)</p>
          <p><span className="text-muted">Uploaded:</span> {formatDateTime(d.createdAt)}</p>
          {d.expiresAt && <p><span className="text-muted">Expires:</span> {new Date(d.expiresAt).toLocaleDateString()}</p>}
          {d.verificationNotes && <p><span className="text-muted">Note from our team:</span> {d.verificationNotes}</p>}
          <div className="flex gap-2 pt-2">
            <a className="text-primary hover:underline" href={`/api/my-documents/${id}/download`}>Download</a>
            <Button size="sm" variant="danger" onClick={remove}>Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
