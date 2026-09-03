import Link from "next/link";
import { ShieldCheck, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/utils";
import type { ProfileListDto } from "@/lib/serializers";

function Avatar({ profile }: { profile: ProfileListDto }) {
  const src = profile.photoId ? `/api/admin/profiles/${profile.id}/photo/${profile.photoId}` : null;
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-sm font-medium text-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={profile.fullName} className="h-full w-full object-cover" />
      ) : (
        profile.fullName.charAt(0)
      )}
    </div>
  );
}

export function ProfileTable({ profiles }: { profiles: ProfileListDto[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="p-3">Profile</th>
              <th className="p-3">Gender</th>
              <th className="p-3">Age</th>
              <th className="p-3">City</th>
              <th className="p-3">Education</th>
              <th className="p-3">Profession</th>
              <th className="p-3">Income</th>
              <th className="p-3">Status</th>
              <th className="p-3">Created</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-muted/50">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <Avatar profile={p} />
                    <div>
                      <p className="font-medium">{p.fullName}</p>
                      <p className="text-xs text-muted flex items-center gap-1">
                        {p.profileCode}
                        {p.verified && <ShieldCheck className="h-3 w-3 text-success" />}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="p-3">{formatEnumLabel(p.gender)}</td>
                <td className="p-3">{p.age}</td>
                <td className="p-3">{p.city}</td>
                <td className="p-3">{p.education ?? "—"}</td>
                <td className="p-3">{p.profession ?? "—"}</td>
                <td className="p-3">{formatCurrency(p.monthlyIncome)}</td>
                <td className="p-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="p-3 text-muted">{formatDate(p.createdAt)}</td>
                <td className="p-3">
                  <Link href={`/admin/profiles/${p.id}`} className="font-medium text-primary hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {profiles.map((p) => (
          <Link
            key={p.id}
            href={`/admin/profiles/${p.id}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
          >
            <Avatar profile={p} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.fullName}</p>
              <p className="text-xs text-muted">
                {p.profileCode} &middot; {p.age} yrs &middot; {p.city}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={p.status} />
                {p.verified && <ShieldCheck className="h-3.5 w-3.5 text-success" />}
              </div>
            </div>
            <Sparkles className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </>
  );
}
