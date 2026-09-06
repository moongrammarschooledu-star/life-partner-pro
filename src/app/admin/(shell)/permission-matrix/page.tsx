"use client";

import { useEffect, useState } from "react";
import { Loader2, KeyRound, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";

interface PermissionDef {
  key: string;
  module: string;
  action: string;
  description: string | null;
}

interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  baseRole: "STAFF" | "VIEWER";
  active: boolean;
  permissions: string[];
}

const SYSTEM_MATRIX: { module: string; superAdmin: string; admin: string; staff: string; viewer: string }[] = [
  { module: "Profiles", superAdmin: "Full", admin: "Manage", staff: "Assigned", viewer: "View" },
  { module: "Contacts", superAdmin: "Full", admin: "Permission", staff: "Restricted", viewer: "No" },
  { module: "Matching", superAdmin: "Full", admin: "Manage", staff: "Assigned", viewer: "View" },
  { module: "Proposals", superAdmin: "Full", admin: "Manage", staff: "Assigned", viewer: "View" },
  { module: "Verification", superAdmin: "Full", admin: "Manage", staff: "Assigned", viewer: "View" },
  { module: "Meetings", superAdmin: "Full", admin: "Manage", staff: "Assigned", viewer: "View" },
  { module: "Communications", superAdmin: "Full", admin: "Manage", staff: "Assigned", viewer: "View" },
  { module: "Reports", superAdmin: "Full", admin: "Manage", staff: "Limited", viewer: "View" },
  { module: "Staff", superAdmin: "Full", admin: "Limited", staff: "No", viewer: "No" },
  { module: "Settings", superAdmin: "Full", admin: "Limited", staff: "No", viewer: "No" },
  { module: "Audit Logs", superAdmin: "Full", admin: "Limited", staff: "No", viewer: "No" },
];

// Spec §28 — the fixed 4-system-role matrix is a read-only reference
// (derived from src/lib/permissions.ts's ROLE_PERMISSIONS, which stays
// hardcoded/zero-risk); "make it configurable" is satisfied by the custom
// role editor below instead of making the 4 built-in roles DB-editable.
export default function PermissionMatrixPage() {
  const { show } = useToast();
  const [roles, setRoles] = useState<CustomRoleRow[] | null>(null);
  const [defs, setDefs] = useState<PermissionDef[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomRoleRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseRole, setBaseRole] = useState<"STAFF" | "VIEWER">("STAFF");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/custom-roles")
      .then((r) => r.json())
      .then((data) => {
        setRoles(data.roles ?? []);
        setDefs(data.permissionDefs ?? []);
      });
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setBaseRole("STAFF");
    setSelected(new Set());
    setError(null);
    setModalOpen(true);
  }

  function openEdit(role: CustomRoleRow) {
    setEditing(role);
    setName(role.name);
    setDescription(role.description ?? "");
    setBaseRole(role.baseRole);
    setSelected(new Set(role.permissions));
    setError(null);
    setModalOpen(true);
  }

  function togglePermission(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const permissions = Array.from(selected);
      const res = editing
        ? await fetch(`/api/admin/custom-roles/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, permissions }),
          })
        : await fetch("/api/admin/custom-roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, baseRole, permissions }),
          });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save custom role.");
        return;
      }
      show(editing ? "Custom role updated" : "Custom role created", "success");
      setModalOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(role: CustomRoleRow) {
    await fetch(`/api/admin/custom-roles/${role.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !role.active }),
    });
    load();
  }

  const grouped = defs.reduce<Record<string, PermissionDef[]>>((acc, d) => {
    (acc[d.module] ??= []).push(d);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Permission Matrix</h1>
        <p className="text-sm text-muted">The 4 built-in roles&rsquo; access, plus any custom roles you&rsquo;ve defined.</p>
      </div>

      <Card>
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="pb-2">Module</th>
                <th className="pb-2">Super Admin</th>
                <th className="pb-2">Admin</th>
                <th className="pb-2">Staff</th>
                <th className="pb-2">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {SYSTEM_MATRIX.map((row) => (
                <tr key={row.module} className="border-t border-border">
                  <td className="py-2 font-medium">{row.module}</td>
                  <td className="py-2 text-muted">{row.superAdmin}</td>
                  <td className="py-2 text-muted">{row.admin}</td>
                  <td className="py-2 text-muted">{row.staff}</td>
                  <td className="py-2 text-muted">{row.viewer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">Custom Roles</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> New Custom Role
        </Button>
      </div>

      {roles === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : roles.length === 0 ? (
        <EmptyState icon={KeyRound} title="No custom roles yet" description="e.g. Verification Manager or Matchmaking Manager with a curated permission set." />
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <Card key={role.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {role.name} <span className="text-xs text-muted">({role.baseRole}-shaped)</span>
                  </p>
                  {role.description && <p className="text-sm text-muted">{role.description}</p>}
                  <p className="mt-1 text-xs text-muted">{role.permissions.length} permission(s)</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant={role.active ? "success" : "muted"}>{role.active ? "Active" : "Disabled"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => openEdit(role)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(role)}>
                    {role.active ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Custom Role" : "New Custom Role"}>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <Field label="Name" htmlFor="roleName">
            <Input id="roleName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description (optional)" htmlFor="roleDescription">
            <Input id="roleDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {!editing && (
            <Field label="Row-scoping shape" htmlFor="baseRole" hint="STAFF-shaped: only assigned records. VIEWER-shaped: read-only.">
              <Select id="baseRole" value={baseRole} onChange={(e) => setBaseRole(e.target.value as "STAFF" | "VIEWER")}>
                <option value="STAFF">STAFF-shaped</option>
                <option value="VIEWER">VIEWER-shaped</option>
              </Select>
            </Field>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Permissions</p>
            <div className="space-y-3">
              {Object.entries(grouped).map(([module, perms]) => (
                <div key={module}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{module}</p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {perms.map((p) => (
                      <Checkbox
                        key={p.key}
                        label={p.description ?? p.key}
                        checked={selected.has(p.key)}
                        onChange={() => togglePermission(p.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button className="w-full" onClick={save} disabled={saving || !name}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Custom Role
          </Button>
        </div>
      </Modal>
    </div>
  );
}
