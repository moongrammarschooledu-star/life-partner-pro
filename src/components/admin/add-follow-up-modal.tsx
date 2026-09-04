"use client";

import { useState } from "react";
import { Loader2, CalendarPlus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function AddFollowUpModal({
  open,
  onClose,
  profileId,
  proposalId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  proposalId?: string;
  onCreated?: () => void;
}) {
  const { show } = useToast();
  const [dueDate, setDueDate] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!dueDate) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, proposalId, dueDate, title: title || undefined, priority, note: note || undefined }),
      });
      if (!res.ok) throw new Error();
      show("Follow-up scheduled", "success");
      setDueDate("");
      setTitle("");
      setNote("");
      setPriority("MEDIUM");
      onCreated?.();
      onClose();
    } catch {
      show("Could not schedule follow-up.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Follow-up">
      <div className="space-y-3">
        <Field label="Date" htmlFor="fuDate">
          <Input id="fuDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Reason / Title" htmlFor="fuTitle">
          <Input id="fuTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Confirm family meeting" />
        </Field>
        <Field label="Priority" htmlFor="fuPriority">
          <Select id="fuPriority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </Select>
        </Field>
        <Field label="Notes" htmlFor="fuNote">
          <Textarea id="fuNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button className="w-full" onClick={save} disabled={saving || !dueDate}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Save
        </Button>
      </div>
    </Modal>
  );
}
