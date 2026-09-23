"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatEnumLabel } from "@/lib/utils";

interface CompareProfile {
  id: string;
  profileCode: string;
  fullName: string;
  age: number;
  city: string;
  education: string | null;
  profession: string | null;
  maritalStatus: string;
  heightCm: number;
  verified: boolean;
  verificationStatus: string | null;
  status: string;
  photoUrl: string | null;
}

const ROWS: Array<{ key: keyof CompareProfile; label: string; format?: (v: unknown) => string }> = [
  { key: "age", label: "Age" },
  { key: "city", label: "Location" },
  { key: "education", label: "Education", format: (v) => (v as string) ?? "—" },
  { key: "profession", label: "Profession", format: (v) => (v as string) ?? "—" },
  { key: "maritalStatus", label: "Marital Status", format: (v) => formatEnumLabel(v as string) },
  { key: "heightCm", label: "Height (cm)" },
  { key: "verificationStatus", label: "Verification", format: (v) => (v ? formatEnumLabel(v as string) : "Not Verified") },
  { key: "status", label: "Profile Status", format: (v) => formatEnumLabel(v as string) },
];

// spec §26 — a pure data comparison; scoreMatch()'s deterministic output is
// the only thing ever shown here. No AI call, no "winner" verdict — the
// administrator makes the final judgment.
export default function ComparePage() {
  const searchParams = useSearchParams();
  const [profiles, setProfiles] = useState<CompareProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length < 2) {
      setError("Select at least 2 candidates from Candidate Discovery to compare.");
      return;
    }
    fetch("/api/admin/search/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileIds: ids }) })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Could not compare candidates.");
        setProfiles(data.profiles);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Link href="/admin/candidate-discovery" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Candidate Discovery
      </Link>
      <h1 className="font-heading text-2xl font-semibold">Compare Candidates</h1>

      {error && <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      {!error && !profiles && <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}

      {profiles && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-3 text-left text-xs uppercase tracking-wide text-muted">Criteria</th>
                {profiles.map((p) => (
                  <th key={p.id} className="p-3 text-left">
                    <div className="h-16 w-16 overflow-hidden rounded-lg bg-surface-muted">
                      {p.photoUrl ? <img src={p.photoUrl} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted">{p.profileCode}</p>
                    <p className="font-medium">{p.fullName}</p>
                    {p.verified && <Badge variant="success">Verified</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium text-muted">{row.label}</td>
                  {profiles.map((p) => (
                    <td key={p.id} className="p-3">{row.format ? row.format(p[row.key]) : String(p[row.key] ?? "—")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
