"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { formatEnumLabel } from "@/lib/utils";

interface EffectivePermissions {
  admin: { id: string; name: string; email: string; role: string; active: boolean; customRole: { id: string; name: string } | null };
  recordAccessIsAssignmentScoped: boolean;
  permissions: string[];
  sensitivePermissions: string[];
  recordAssignments: {
    profiles: number;
    followUps: number;
    cases: number;
    proposals: number;
    verifications: number;
    securityFlags: number;
  };
}

// STEP 17 §43 — read-only view of exactly what an admin can do today, so
// "why can this person see X" never requires reading code to answer.
export function EffectivePermissionsPanel({ adminId, onClose }: { adminId: string; onClose: () => void }) {
  const [data, setData] = useState<EffectivePermissions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/admin/admin-users/${adminId}/effective-permissions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setData)
      .catch(() => setError("Could not load effective permissions."));
  }, [adminId]);

  return (
    <Modal open onClose={onClose} title={data ? `Effective Permissions — ${data.admin.name}` : "Effective Permissions"}>
      {!data ? (
        <div className="flex h-32 items-center justify-center">
          {error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="h-5 w-5 animate-spin text-muted" />}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{formatEnumLabel(data.admin.role)}</Badge>
            {data.admin.customRole && <Badge variant="muted">Custom: {data.admin.customRole.name}</Badge>}
            <Badge variant={data.recordAccessIsAssignmentScoped ? "muted" : "success"}>
              {data.recordAccessIsAssignmentScoped ? "Assignment-scoped record access" : "Broad record access"}
            </Badge>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Permissions ({data.permissions.length})
            </p>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2">
              {data.permissions.map((p) => (
                <span key={p} className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                  {p}
                </span>
              ))}
            </div>
          </div>

          {data.sensitivePermissions.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-danger">
                <ShieldAlert className="h-3.5 w-3.5" /> Sensitive permissions ({data.sensitivePermissions.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {data.sensitivePermissions.map((p) => (
                  <span key={p} className="rounded bg-danger/10 px-1.5 py-0.5 font-mono text-xs text-danger">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.recordAccessIsAssignmentScoped && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Active record assignments</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>Profiles: <span className="font-medium">{data.recordAssignments.profiles}</span></div>
                <div>Follow-ups: <span className="font-medium">{data.recordAssignments.followUps}</span></div>
                <div>Cases: <span className="font-medium">{data.recordAssignments.cases}</span></div>
                <div>Proposals: <span className="font-medium">{data.recordAssignments.proposals}</span></div>
                <div>Verifications: <span className="font-medium">{data.recordAssignments.verifications}</span></div>
                <div>Security flags: <span className="font-medium">{data.recordAssignments.securityFlags}</span></div>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
