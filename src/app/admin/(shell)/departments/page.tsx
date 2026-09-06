"use client";

import { useEffect, useState } from "react";
import { Loader2, Building2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

// Spec §22 — Registration, Verification, Matching, Proposal Management,
// Family Coordination, Customer Support are suggested examples, not a fixed
// list; Super Admin can create whatever departments fit their team.
export default function DepartmentsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<DepartmentRow[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/departments")
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []));
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create department.");
        return;
      }
      show("Department created", "success");
      setModalOpen(false);
      setName("");
      setDescription("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(dep: DepartmentRow) {
    await fetch(`/api/admin/departments/${dep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !dep.active }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Departments</h1>
          <p className="text-sm text-muted">Organize staff into departments, e.g. Verification, Matching, Customer Support.</p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> Add Department
        </Button>
      </div>

      {items === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Building2} title="No departments yet" description="Create one to start organizing staff by function." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="p-3">Name</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium">{d.name}</td>
                    <td className="p-3 text-muted">{d.description ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant={d.active ? "success" : "muted"}>{d.active ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" onClick={() => toggleActive(d)}>
                        {d.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Department">
        <div className="space-y-4">
          <Field label="Name" htmlFor="depName">
            <Input id="depName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description (optional)" htmlFor="depDescription">
            <Input id="depDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button className="w-full" onClick={create} disabled={creating || !name}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" />} Create Department
          </Button>
        </div>
      </Modal>
    </div>
  );
}
