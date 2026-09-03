"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea, Select, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { StickyNote } from "lucide-react";

interface Note {
  id: string;
  text: string;
  createdAt: string | Date;
  adminName: string;
}

export function NotesTab({ profileId, notes: initialNotes }: { profileId: string; notes: Note[] }) {
  const { show } = useToast();
  const [notes, setNotes] = useState(initialNotes);
  const [text, setText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);

  const [commType, setCommType] = useState("PHONE_CALL");
  const [commNotes, setCommNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [submittingComm, setSubmittingComm] = useState(false);

  async function addNote() {
    if (!text.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      const note = await res.json();
      setNotes((prev) => [note, ...prev]);
      setText("");
      show("Note added", "success");
    } catch {
      show("Could not add note.", "error");
    } finally {
      setSubmittingNote(false);
    }
  }

  async function logCommunication() {
    setSubmittingComm(true);
    try {
      const res = await fetch("/api/admin/communications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, type: commType, notes: commNotes, followUpDate: followUpDate || undefined }),
      });
      if (!res.ok) throw new Error();
      show("Communication logged", "success");
      setCommNotes("");
      setFollowUpDate("");
    } catch {
      show("Could not log communication.", "error");
    } finally {
      setSubmittingComm(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Internal Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Textarea placeholder="Add an internal note..." value={text} onChange={(e) => setText(e.target.value)} className="min-h-16" />
          </div>
          <Button size="sm" onClick={addNote} disabled={submittingNote || !text.trim()}>
            {submittingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Add Note
          </Button>

          <div className="space-y-3 pt-2">
            {notes.length === 0 ? (
              <EmptyState icon={StickyNote} title="No notes yet" />
            ) : (
              notes.map((n) => (
                <div key={n.id} className="rounded-lg border border-border p-3 text-sm">
                  <p>{n.text}</p>
                  <p className="mt-1 text-xs text-muted">
                    {n.adminName} &middot; {formatDateTime(n.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log Communication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={commType} onChange={(e) => setCommType(e.target.value)}>
            <option value="PHONE_CALL">Phone Call</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
            <option value="MEETING">Meeting</option>
            <option value="FOLLOW_UP">Follow-up</option>
          </Select>
          <Textarea placeholder="Notes about this communication" value={commNotes} onChange={(e) => setCommNotes(e.target.value)} />
          <div>
            <label className="text-sm font-medium">Follow-up date (optional)</label>
            <Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="mt-1.5" />
          </div>
          <Button size="sm" onClick={logCommunication} disabled={submittingComm}>
            {submittingComm && <Loader2 className="h-4 w-4 animate-spin" />} Save Communication
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
