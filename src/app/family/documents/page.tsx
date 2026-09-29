"use client";

import { useEffect, useState } from "react";
import { Loader2, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatEnumLabel } from "@/lib/utils";

interface DocItem { id: string; documentCode: string; typeKey: string; classification: string; originalFilename: string; createdAt: string }

// Only documents the applicant EXPLICITLY shared with this family member — profile access never implies
// document access.
export default function FamilyDocumentsPage() {
  const [items, setItems] = useState<DocItem[] | null>(null);

  useEffect(() => {
    fetch("/api/family/documents").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setItems(j.items ?? []));
  }, []);

  if (!items) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Documents</h1>
        <p className="mt-1 text-sm text-muted">Documents the applicant has explicitly shared with you. Nothing else is visible here, whatever else you can see about their profile.</p>
      </div>
      <Card>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={FileText} title="No documents shared with you" />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-1 py-3 text-sm">
                  <span><span className="font-medium">{formatEnumLabel(d.typeKey)}</span> <span className="ml-2 text-xs text-muted">{d.originalFilename}</span></span>
                  <a className="text-primary hover:underline" href={`/api/family/documents/${d.id}/download`}>Download</a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
