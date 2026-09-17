"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlusCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { categoriesForType } from "@/lib/case-categories";
import { formatEnumLabel } from "@/lib/utils";

interface StaffOption {
  id: string;
  name: string;
  role: string;
  active?: boolean;
}

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"];

// Admin/staff-initiated internal case (spec §1) — the equivalent of
// /my-cases/new for staff, backed by the same POST /api/admin/cases route
// that already exists.
export function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { show } = useToast();
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [reportedProfileCode, setReportedProfileCode] = useState("");
  const [reportedAdminId, setReportedAdminId] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setStaff((data.items ?? []).filter((a: StaffOption) => a.active !== false)))
      .catch(() => {});
  }, [open]);

  function reset() {
    setCategory("");
    setSubject("");
    setDescription("");
    setPriority("NORMAL");
    setReportedProfileCode("");
    setReportedAdminId("");
    setError(null);
  }

  async function submit() {
    if (!category || !subject.trim() || !description.trim()) {
      setError("Category, subject, and description are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject,
          description,
          priority,
          reportedProfileCode: reportedProfileCode || undefined,
          reportedAdminId: reportedAdminId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create case.");
        return;
      }
      show(`Case created — ${json.caseNumber}`, "success");
      reset();
      onClose();
      router.push(`/admin/case-management/${json.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New Internal Case">
      <div className="space-y-3">
        <Field label="Category" htmlFor="nc-category">
          <Select id="nc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Select a category…</option>
            {categoriesForType("INTERNAL").map((c) => (
              <option key={c} value={c}>{formatEnumLabel(c)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor="nc-subject">
          <Input id="nc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="nc-description">
          <Textarea id="nc-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="nc-priority">
          <Select id="nc-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{formatEnumLabel(p)}</option>)}
          </Select>
        </Field>
        <Field label="Reported Profile ID (optional)" htmlFor="nc-profile" hint="Only if this case concerns a specific profile.">
          <Input id="nc-profile" value={reportedProfileCode} onChange={(e) => setReportedProfileCode(e.target.value)} placeholder="LPP-000123" />
        </Field>
        <Field label="Reported Staff Member (optional)" htmlFor="nc-admin" hint="Staff-conduct cases are only visible to authorized senior staff.">
          <Select id="nc-admin" value={reportedAdminId} onChange={(e) => setReportedAdminId(e.target.value)}>
            <option value="">None</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatEnumLabel(s.role)})</option>)}
          </Select>
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button className="w-full" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />} Create Case
        </Button>
      </div>
    </Modal>
  );
}
