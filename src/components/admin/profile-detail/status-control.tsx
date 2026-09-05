"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Archive, ArchiveRestore, Ban } from "lucide-react";
import { Select } from "@/components/ui/form";
import { Button, buttonClass } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

const STATUSES = [
  "NEW", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "MATCHING", "PROPOSAL_SENT",
  "WAITING_FOR_RESPONSE", "INTERESTED", "NOT_INTERESTED", "MEETING_ARRANGED",
  "FINALIZED", "MARRIED", "REJECTED", "ARCHIVED", "SUSPENDED",
];

export function StatusControl({
  profileId,
  status,
  verified,
  softDeleted,
  onChanged,
}: {
  profileId: string;
  status: string;
  verified: boolean;
  softDeleted: boolean;
  onChanged: () => void;
}) {
  const { show } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [busy, setBusy] = useState(false);

  async function changeStatus(newStatus: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      show("Status updated", "success");
      onChanged();
    } catch {
      show("Could not update status. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function suspend() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/verification/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suspend" }),
      });
      if (!res.ok) throw new Error();
      show("Profile suspended", "success");
      onChanged();
    } catch {
      show("Could not suspend profile.", "error");
    } finally {
      setBusy(false);
      setConfirmSuspend(false);
    }
  }

  async function archiveOrRestore() {
    setBusy(true);
    try {
      const endpoint = softDeleted ? "restore" : undefined;
      const res = endpoint
        ? await fetch(`/api/admin/profiles/${profileId}/restore`, { method: "POST" })
        : await fetch(`/api/admin/profiles/${profileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      show(softDeleted ? "Profile restored" : "Profile archived", "success");
      onChanged();
    } catch {
      show("Action failed. Please try again.", "error");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={status}
        disabled={busy}
        onChange={(e) => changeStatus(e.target.value)}
        className="w-auto"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {formatEnumLabel(s)}
          </option>
        ))}
      </Select>
      {/* The one-click Verify shortcut was replaced by a link to the full
          Verification Review page (checklist, OTP status, documents,
          flags) — a single button bypassing that whole workflow would
          undermine the point of STEP 8. */}
      <Link href={`/admin/verification/${profileId}`} className={buttonClass({ variant: verified ? "outline" : "secondary", size: "sm" })}>
        <ShieldCheck className="h-4 w-4" /> Review Verification
      </Link>
      {status !== "SUSPENDED" && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmSuspend(true)}>
          <Ban className="h-4 w-4" /> Suspend
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={busy} onClick={softDeleted ? archiveOrRestore : () => setConfirmDelete(true)}>
        {softDeleted ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        {softDeleted ? "Restore" : "Archive"}
      </Button>

      <ConfirmDialog
        open={confirmDelete}
        title="Archive this profile?"
        description="The profile will be archived and hidden from active search results. This can be reversed by an admin at any time."
        confirmLabel="Archive"
        danger
        onConfirm={archiveOrRestore}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmSuspend}
        title="Suspend this profile?"
        description="A suspended profile is removed from the active matching pool and treated as unverified until reinstated by an admin."
        confirmLabel="Suspend"
        danger
        onConfirm={suspend}
        onCancel={() => setConfirmSuspend(false)}
      />
    </div>
  );
}
