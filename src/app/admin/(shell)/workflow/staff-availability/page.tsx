"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

interface Availability {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
  active: boolean;
  admin: { id: string; name: string };
  backupAdmin: { id: string; name: string } | null;
}

// STEP 18 §44 — Staff Absence. New tasks may route to backupAdminId when
// configured; existing tasks never move automatically.
export default function StaffAvailabilityPage() {
  const { show } = useToast();
  const [items, setItems] = useState<Availability[] | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [adminId, setAdminId] = useState("");
  const [backupAdminId, setBackupAdminId] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/admin/staff-availability")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load();
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setStaff((data.items ?? []).filter((a: { active?: boolean }) => a.active !== false)))
      .catch(() => {});
  }, []);

  function openCreate() {
    setAdminId("");
    setBackupAdminId("");
    setStartAt("");
    setEndAt("");
    setReason("");
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/staff-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, backupAdminId: backupAdminId || undefined, startAt, endAt, reason: reason || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not save.", "error");
        return;
      }
      show("Saved", "success");
      setModalOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(item: Availability) {
    await fetch(`/api/admin/staff-availability/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    load();
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/workflow" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Workflow &amp; Tasks
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Staff Availability</h1>
          <p className="text-sm text-muted">Temporary unavailability with optional backup routing for new tasks.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Entry
        </Button>
      </div>

      {items === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Plus} title="No active entries" description="Record time off or unavailability for a staff member." />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{item.admin.name}</p>
                  <p className="text-sm text-muted">
                    {formatDateTime(item.startAt)} → {formatDateTime(item.endAt)}
                    {item.backupAdmin && <> · Backup: {item.backupAdmin.name}</>}
                  </p>
                  {item.reason && <p className="text-xs text-muted">{item.reason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={item.active ? "warning" : "muted"}>{item.active ? "Active" : "Ended"}</Badge>
                  {item.active && (
                    <Button size="sm" variant="outline" onClick={() => deactivate(item)}>End Now</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Availability Entry">
        <div className="space-y-4">
          <Field label="Staff Member" htmlFor="aAdmin">
            <Select id="aAdmin" value={adminId} onChange={(e) => setAdminId(e.target.value)}>
              <option value="">Select…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Backup (optional)" htmlFor="aBackup">
            <Select id="aBackup" value={backupAdminId} onChange={(e) => setBackupAdminId(e.target.value)}>
              <option value="">None</option>
              {staff.filter((s) => s.id !== adminId).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start" htmlFor="aStart">
            <Input id="aStart" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <Field label="End" htmlFor="aEnd">
            <Input id="aEnd" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </Field>
          <Field label="Reason (optional)" htmlFor="aReason">
            <Input id="aReason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button className="w-full" onClick={save} disabled={saving || !adminId || !startAt || !endAt}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}
