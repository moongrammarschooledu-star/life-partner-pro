"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Pencil, Sliders, Images } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";

interface SelfProfileView {
  profileCode: string;
  status: string;
  verified: boolean;
  profileCompletion: number;
  personal: Record<string, unknown>;
  contact: Record<string, unknown> | null;
  education: Record<string, unknown> | null;
  profession: Record<string, unknown> | null;
  family: Record<string, unknown> | null;
  lifestyle: Record<string, unknown> | null;
  partnerPreference: Record<string, unknown> | null;
  hasPendingUpdate: boolean;
  pendingUpdateSubmittedAt: string | null;
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "Not provided";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function Section({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted">Not provided</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(data)
              .filter(([k]) => !["id", "profileId"].includes(k))
              .map(([k, v]) => (
                <div key={k} className="text-sm">
                  <dt className="text-xs text-muted">{formatEnumLabel(k)}</dt>
                  <dd>{fmt(v)}</dd>
                </div>
              ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyProfileViewPage() {
  const [data, setData] = useState<SelfProfileView | null>(null);

  useEffect(() => {
    fetch("/api/my-profile")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">My Profile</h1>
          <p className="text-sm text-muted">Profile ID: {data.profileCode}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/profile/edit"><Button size="sm" variant="outline"><Pencil className="h-4 w-4" /> Edit Profile</Button></Link>
          <Link href="/dashboard/profile/partner-requirements"><Button size="sm" variant="outline"><Sliders className="h-4 w-4" /> Partner Requirements</Button></Link>
          <Link href="/dashboard/profile/photos"><Button size="sm" variant="outline"><Images className="h-4 w-4" /> Photos</Button></Link>
        </div>
      </div>

      {data.hasPendingUpdate && (
        <Card>
          <CardContent className="flex items-center justify-between py-3 text-sm">
            <span>You have a profile update request pending admin review{data.pendingUpdateSubmittedAt ? ` (submitted ${formatDateTime(data.pendingUpdateSubmittedAt)})` : ""}.</span>
            <Badge variant="muted">Pending</Badge>
          </CardContent>
        </Card>
      )}

      <Section title="Personal Information" data={data.personal} />
      <Section title="Contact Information" data={data.contact} />
      <Section title="Education" data={data.education} />
      <Section title="Career" data={data.profession} />
      <Section title="Family" data={data.family} />
      <Section title="Lifestyle" data={data.lifestyle} />
      <Section title="Partner Requirements" data={data.partnerPreference} />
    </div>
  );
}
