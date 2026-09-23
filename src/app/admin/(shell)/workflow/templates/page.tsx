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
import { formatEnumLabel } from "@/lib/utils";
import { TASK_TYPES, TASK_PRIORITIES } from "@/lib/workflow/task-types";

interface Template {
  id: string;
  name: string;
  taskType: string;
  titleTemplate: string;
  descriptionTemplate: string | null;
  defaultPriority: string;
  active: boolean;
}

// STEP 18 §26/§27 — Admin → Task Templates.
export default function TaskTemplatesPage() {
  const { show } = useToast();
  const [items, setItems] = useState<Template[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<string>(TASK_TYPES[0]);
  const [titleTemplate, setTitleTemplate] = useState("");
  const [descriptionTemplate, setDescriptionTemplate] = useState("");
  const [defaultPriority, setDefaultPriority] = useState("NORMAL");
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/admin/tasks/templates")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setName("");
    setTaskType(TASK_TYPES[0]);
    setTitleTemplate("");
    setDescriptionTemplate("");
    setDefaultPriority("NORMAL");
    setModalOpen(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setName(t.name);
    setTaskType(t.taskType);
    setTitleTemplate(t.titleTemplate);
    setDescriptionTemplate(t.descriptionTemplate ?? "");
    setDefaultPriority(t.defaultPriority);
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const body = { name, taskType, titleTemplate, descriptionTemplate: descriptionTemplate || undefined, defaultPriority };
      const res = editing
        ? await fetch(`/api/admin/tasks/templates/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/tasks/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not save template.", "error");
        return;
      }
      show(editing ? "Template updated" : "Template created", "success");
      setModalOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: Template) {
    await fetch(`/api/admin/tasks/templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !t.active }) });
    load();
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/workflow" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Workflow &amp; Tasks
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Task Templates</h1>
          <p className="text-sm text-muted">Reusable defaults for manually-created tasks.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {items === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Plus} title="No templates yet" description="Create one to speed up manual task creation." />
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t.name} <span className="text-xs text-muted">({formatEnumLabel(t.taskType)})</span></p>
                  <p className="text-sm text-muted">{t.titleTemplate}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={t.active ? "success" : "muted"}>{t.active ? "Active" : "Disabled"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => openEdit(t)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(t)}>{t.active ? "Disable" : "Enable"}</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Template" : "New Template"}>
        <div className="space-y-4">
          <Field label="Name" htmlFor="tName">
            <Input id="tName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!editing && (
            <Field label="Task Type" htmlFor="tType">
              <Select id="tType" value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>{formatEnumLabel(t)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Default Title" htmlFor="tTitle">
            <Input id="tTitle" value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} />
          </Field>
          <Field label="Default Description (optional)" htmlFor="tDesc">
            <Input id="tDesc" value={descriptionTemplate} onChange={(e) => setDescriptionTemplate(e.target.value)} />
          </Field>
          <Field label="Default Priority" htmlFor="tPriority">
            <Select id="tPriority" value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>{formatEnumLabel(p)}</option>
              ))}
            </Select>
          </Field>
          <Button className="w-full" onClick={save} disabled={saving || !name || !titleTemplate}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Template
          </Button>
        </div>
      </Modal>
    </div>
  );
}
