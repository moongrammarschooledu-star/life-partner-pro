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
import { formatEnumLabel } from "@/lib/utils";
import { ADMIN_ROLES, ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";

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
  baseRole: AdminRole;
  active: boolean;
  permissions: string[];
  allowedRecordTypes: string[];
  defaultAccessLevel: string | null;
}

// STEP 17 §48 — the matrix is generated live from ROLE_PERMISSIONS (the
// actual authorization source of truth in src/lib/permissions.ts), grouped by
// module. A row shows "✓" when the role holds at least one permission in that
// module, with an "S" marker when any of those permissions is sensitive
// (SENSITIVE_PERMISSIONS) — this is a disclosed simplification of spec's
// per-permission ✓/—/A/S/C/H annotation (13 roles × ~150 permissions would be
// unreadable at that granularity); the per-admin Effective Permissions panel
// (admin-users page) gives the exact, ungrouped permission list when needed.
function buildMatrix(modules: string[]) {
  return modules.map((module) => ({
    module,
    cells: ADMIN_ROLES.map((role) => {
      const inModule = (ROLE_PERMISSIONS[role] ?? []).filter((p) => p.startsWith(`${module}:`));
      return {
        role,
        granted: inModule.length > 0,
        sensitive: inModule.some((p) => (SENSITIVE_PERMISSIONS as string[]).includes(p)),
      };
    }),
  }));
}

export default function PermissionMatrixPage() {
  const { show } = useToast();
  const [roles, setRoles] = useState<CustomRoleRow[] | null>(null);
  const [defs, setDefs] = useState<PermissionDef[]>([]);
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [accessLevels, setAccessLevels] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomRoleRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseRole, setBaseRole] = useState<AdminRole>("STAFF_MATCHMAKER");
  const [allowedRecordTypes, setAllowedRecordTypes] = useState<Set<string>>(new Set());
  const [defaultAccessLevel, setDefaultAccessLevel] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/custom-roles")
      .then((r) => r.json())
      .then((data) => {
        setRoles(data.roles ?? []);
        setDefs(data.permissionDefs ?? []);
        setResourceTypes(data.resourceTypes ?? []);
        setAccessLevels(data.accessLevels ?? []);
      });
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setBaseRole("STAFF_MATCHMAKER");
    setAllowedRecordTypes(new Set());
    setDefaultAccessLevel("");
    setSelected(new Set());
    setError(null);
    setModalOpen(true);
  }

  function openEdit(role: CustomRoleRow) {
    setEditing(role);
    setName(role.name);
    setDescription(role.description ?? "");
    setBaseRole(role.baseRole);
    setAllowedRecordTypes(new Set(role.allowedRecordTypes ?? []));
    setDefaultAccessLevel(role.defaultAccessLevel ?? "");
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

  function toggleRecordType(type: string) {
    setAllowedRecordTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const permissions = Array.from(selected);
      const body = {
        name,
        description,
        permissions,
        allowedRecordTypes: Array.from(allowedRecordTypes),
        defaultAccessLevel: defaultAccessLevel || null,
      };
      const res = editing
        ? await fetch(`/api/admin/custom-roles/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/custom-roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, baseRole }),
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

  const modules = Object.keys(grouped).sort();
  const matrix = buildMatrix(modules);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Permission Matrix</h1>
        <p className="text-sm text-muted">
          The 13 system roles&rsquo; access by module, generated from the live permission table, plus any custom roles you&rsquo;ve
          defined. &ldquo;S&rdquo; marks a module where the role holds at least one sensitive permission.
        </p>
      </div>

      <Card>
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[1400px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="pb-2 pr-3">Module</th>
                {ADMIN_ROLES.map((role) => (
                  <th key={role} className="whitespace-nowrap pb-2 pr-3">
                    {formatEnumLabel(role)}
                    <span className="block font-normal normal-case text-muted">
                      {hasBroadRecordAccess(role) ? "Broad" : "Assigned"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.module} className="border-t border-border">
                  <td className="py-2 pr-3 font-medium capitalize">{row.module.replace(/_/g, " ")}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.role} className="py-2 pr-3 text-muted">
                      {cell.granted ? "✓" : "—"}
                      {cell.sensitive && <span className="ml-1 text-danger">S</span>}
                    </td>
                  ))}
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
                    {role.name} <span className="text-xs text-muted">({formatEnumLabel(role.baseRole)}-shaped)</span>
                  </p>
                  {role.description && <p className="text-sm text-muted">{role.description}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {role.permissions.length} permission(s)
                    {role.defaultAccessLevel && ` · default access ${formatEnumLabel(role.defaultAccessLevel)}`}
                  </p>
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
            <Field label="Row-scoping shape" htmlFor="baseRole" hint="Which of the 13 system roles' record-access shape (broad vs. assigned-only) this custom role uses.">
              <Select id="baseRole" value={baseRole} onChange={(e) => setBaseRole(e.target.value as AdminRole)}>
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {formatEnumLabel(r)} ({hasBroadRecordAccess(r) ? "broad" : "assigned"})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {resourceTypes.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">Allowed record types (optional)</p>
              <p className="mb-2 text-xs text-muted">Which kinds of records this role can be assigned to. Leave empty for no restriction.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {resourceTypes.map((t) => (
                  <Checkbox key={t} label={formatEnumLabel(t)} checked={allowedRecordTypes.has(t)} onChange={() => toggleRecordType(t)} />
                ))}
              </div>
            </div>
          )}
          {accessLevels.length > 0 && (
            <Field label="Default access level (optional)" htmlFor="defaultAccessLevel" hint="Access level granted by default when this role is assigned to a record.">
              <Select id="defaultAccessLevel" value={defaultAccessLevel} onChange={(e) => setDefaultAccessLevel(e.target.value)}>
                <option value="">None</option>
                {accessLevels.map((l) => (
                  <option key={l} value={l}>
                    {formatEnumLabel(l)}
                  </option>
                ))}
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
