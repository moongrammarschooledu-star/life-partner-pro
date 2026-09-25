"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEnumLabel } from "@/lib/utils";

function Section({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted">Not shared with you.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(data).map(([k, v]) => (
              <div key={k} className="text-sm">
                <dt className="text-xs text-muted">{formatEnumLabel(k)}</dt>
                <dd>{v == null || v === "" ? "—" : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export default function FamilyApplicantPage() {
  const [data, setData] = useState<Record<string, unknown> | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/family/applicant").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  if (data === undefined) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Applicant Profile</h1>
        <Card><CardContent className="py-8 text-center text-sm text-muted">You don&apos;t currently have permission to view this profile.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Applicant Profile</h1>
        <p className="mt-1 text-sm text-muted">Only the information the applicant has authorized you to see. Sections not shared show as unavailable.</p>
      </div>
      <Section title="Personal Information" data={data.personal as Record<string, unknown>} />
      <Section title="Education" data={data.education as Record<string, unknown>} />
      <Section title="Career" data={data.profession as Record<string, unknown>} />
      <Section title="Family" data={data.family as Record<string, unknown>} />
      <Section title="Lifestyle" data={data.lifestyle as Record<string, unknown>} />
      <Section title="Partner Requirements" data={data.partnerPreference as Record<string, unknown>} />
    </div>
  );
}
