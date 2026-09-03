"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn, formatEnumLabel } from "@/lib/utils";
import { StatusControl } from "@/components/admin/profile-detail/status-control";
import { ContactPanel } from "@/components/admin/profile-detail/contact-panel";
import { PendingUpdateCard } from "@/components/admin/profile-detail/pending-update-card";
import { OverviewTab } from "@/components/admin/profile-detail/overview-tab";
import { MatchesTab } from "@/components/admin/profile-detail/matches-tab";
import { NotesTab } from "@/components/admin/profile-detail/notes-tab";
import type { ProfileDetailDto } from "@/lib/serializers";

const TABS = ["Overview", "Matches", "Notes & Communication"] as const;

function Avatar({ profile }: { profile: ProfileDetailDto }) {
  const primaryPhoto = profile.photos.find((p) => p.isPrimary) ?? profile.photos[0];
  const src = primaryPhoto ? `/api/admin/profiles/${profile.id}/photo/${primaryPhoto.id}` : null;
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-2xl font-medium text-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={profile.fullName} className="h-full w-full object-cover" />
      ) : (
        profile.fullName.charAt(0)
      )}
    </div>
  );
}

export function ProfileDetailClient({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<ProfileDetailDto | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  const load = useCallback(() => {
    fetch(`/api/admin/profiles/${profileId}`)
      .then((r) => r.json())
      .then(setProfile);
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!profile) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/profiles" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Profiles
      </Link>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar profile={profile} />
          <div>
            <h1 className="font-heading text-xl font-semibold flex items-center gap-2">
              {profile.fullName}
              {profile.verified && <ShieldCheck className="h-4 w-4 text-success" />}
            </h1>
            <p className="text-sm text-muted">
              {profile.profileCode} &middot; {formatEnumLabel(profile.gender)} &middot; {profile.age} yrs &middot; {profile.city}
            </p>
            <div className="mt-1">
              <StatusBadge status={profile.status} />
            </div>
          </div>
        </div>
        <StatusControl
          profileId={profile.id}
          status={profile.status}
          verified={profile.verified}
          softDeleted={profile.softDeleted}
          onChanged={load}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === t ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-muted"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "Overview" && <OverviewTab profile={profile} />}
          {tab === "Matches" && <MatchesTab profileId={profile.id} />}
          {tab === "Notes & Communication" && <NotesTab profileId={profile.id} notes={profile.notes} />}
        </div>

        <div className="space-y-4">
          {profile.pendingUpdate && (
            <PendingUpdateCard profileId={profile.id} pendingUpdate={profile.pendingUpdate} onResolved={load} />
          )}
          <ContactPanel profileId={profile.id} />
        </div>
      </div>
    </div>
  );
}
