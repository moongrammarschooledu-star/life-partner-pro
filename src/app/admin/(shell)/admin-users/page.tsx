"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, ShieldCheck, KeyRound, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import Link from "next/link";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "STAFF" | "VIEWER";
  active: boolean;
  createdAt: string;
  lastLogin: string | null;
  twoFactorEnabled: boolean;
  department: { id: string; name: string } | null;
  customRole: { id: string; name: string } | null;
}

const ROLES = ["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER"];

export default function AdminUsersPage() {
  const { show } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<AdminUserRow[] | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [customRoles, setCustomRoles] = useState<{ id: string; name: string }[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("STAFF");
  const [departmentId, setDepartmentId] = useState("");
  const [customRoleId, setCustomRoleId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deactivating, setDeactivating] = useState<AdminUserRow | null>(null);
  const [deactivateAction, setDeactivateAction] = useState<"reassign" | "unassign" | "department">("unassign");
  const [reassignTo, setReassignTo] = useState("");
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);

  function load() {
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
    fetch("/api/admin/departments")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setDepartments(data.items ?? []))
      .catch(() => {});
    fetch("/api/admin/custom-roles")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setCustomRoles((data.roles ?? []).filter((r: { active: boolean }) => r.active)))
      .catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  async function createAdmin() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role, departmentId: departmentId || undefined, customRoleId: customRoleId || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not create admin.");
        return;
      }
      show("Admin account created", "success");
      setModalOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setRole("STAFF");
      setDepartmentId("");
      setCustomRoleId("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function updateAdmin(id: string, data: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/admin/admin-users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error);
      }
      show("Admin updated", "success");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not update admin.", "error");
    }
  }

  async function resetPassword(id: string) {
    const res = await fetch(`/api/admin/admin-users/${id}/reset-password`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      show(json.error ?? "Could not reset password.", "error");
      return;
    }
    window.prompt("New temporary password (share this securely — it will not be shown again):", json.tempPassword);
    show("Password reset. The admin must set a new password on next login.", "success");
  }

  async function startViewAs(a: AdminUserRow) {
    const reason = window.prompt(`Reason for viewing as ${a.name} (required, fully audited, read-only, expires in 15 minutes):`);
    if (!reason?.trim()) return;
    const res = await fetch("/api/admin/view-as/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetAdminId: a.id, reason }),
    });
    const json = await res.json();
    if (!res.ok) {
      show(json.error ?? "Could not start View-As.", "error");
      return;
    }
    router.push("/admin/dashboard");
    router.refresh();
  }

  function openDeactivate(a: AdminUserRow) {
    setDeactivating(a);
    setDeactivateAction("unassign");
    setReassignTo("");
    setStepUpPassword("");
    setDeactivateError(null);
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    setDeactivateBusy(true);
    setDeactivateError(null);
    try {
      const reauth = await fetch("/api/admin/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: stepUpPassword }),
      });
      const reauthJson = await reauth.json();
      if (!reauth.ok) {
        setDeactivateError(reauthJson.error ?? "Incorrect password.");
        return;
      }

      const res = await fetch(`/api/admin/admin-users/${deactivating.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: deactivateAction, reassignTo: reassignTo || undefined, stepUpToken: reauthJson.token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDeactivateError(json.error ?? "Could not deactivate admin.");
        return;
      }
      show("Admin deactivated", "success");
      setDeactivating(null);
      load();
    } finally {
      setDeactivateBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Admin Users</h1>
          <p className="text-sm text-muted">Manage who has access to the admin dashboard and what they can do.</p>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <UserPlus className="h-4 w-4" /> Add Admin
        </Button>
      </div>

      {items === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Department</th>
                  <th className="p-3">2FA</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last Login</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium">
                      <span className="flex items-center gap-1.5">
                        {a.name} {a.role === "SUPER_ADMIN" && <ShieldCheck className="h-3.5 w-3.5 text-success" />}
                      </span>
                      {a.customRole && <span className="block text-xs text-muted">{a.customRole.name}</span>}
                    </td>
                    <td className="p-3 text-muted">{a.email}</td>
                    <td className="p-3">
                      <Select value={a.role} onChange={(e) => updateAdmin(a.id, { role: e.target.value })} className="h-8 w-auto text-xs">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {formatEnumLabel(r)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3">
                      <Select
                        value={a.department?.id ?? ""}
                        onChange={(e) => updateAdmin(a.id, { departmentId: e.target.value || null })}
                        className="h-8 w-auto text-xs"
                      >
                        <option value="">None</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3">
                      <Checkbox
                        label=""
                        checked={a.twoFactorEnabled}
                        onChange={(e) => updateAdmin(a.id, { twoFactorEnabled: e.target.checked })}
                      />
                    </td>
                    <td className="p-3">
                      <Badge variant={a.active ? "success" : "muted"}>{a.active ? "Active" : "Deactivated"}</Badge>
                    </td>
                    <td className="p-3 text-muted">{a.lastLogin ? formatDateTime(a.lastLogin) : "Never"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Link href={`/admin/admin-users/${a.id}/sessions`} className="text-xs font-medium text-primary hover:underline">
                          Sessions
                        </Link>
                        <Button size="sm" variant="outline" onClick={() => resetPassword(a.id)}>
                          <KeyRound className="h-3.5 w-3.5" /> Reset
                        </Button>
                        {a.active && (
                          <Button size="sm" variant="outline" onClick={() => startViewAs(a)}>
                            <Eye className="h-3.5 w-3.5" /> View As
                          </Button>
                        )}
                        {a.active ? (
                          <Button size="sm" variant="outline" onClick={() => openDeactivate(a)}>
                            Deactivate
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => updateAdmin(a.id, { active: true })}>
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Admin">
        <div className="space-y-4">
          <Field label="Name" htmlFor="newName">
            <Input id="newName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="newEmail">
            <Input id="newEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Temporary Password" htmlFor="newPassword" hint="At least 8 characters. Share this with them securely.">
            <Input id="newPassword" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Role" htmlFor="newRole">
            <Select id="newRole" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {formatEnumLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Custom Role (optional)" htmlFor="newCustomRole" hint="Overrides the flat role permission set above.">
            <Select id="newCustomRole" value={customRoleId} onChange={(e) => setCustomRoleId(e.target.value)}>
              <option value="">None — use standard role permissions</option>
              {customRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department (optional)" htmlFor="newDepartment">
            <Select id="newDepartment" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button className="w-full" onClick={createAdmin} disabled={creating || !name || !email || !password}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" />} Create Admin
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivating}
        title={`Deactivate ${deactivating?.name ?? ""}`}
        description="Deactivating disables their login but never deletes their historical records. What should happen to their currently assigned work?"
        confirmLabel="Deactivate"
        danger
        confirmDisabled={deactivateBusy || !stepUpPassword || (deactivateAction === "reassign" && !reassignTo)}
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivating(null)}
      >
        <Field label="Assigned records" htmlFor="deactivateAction">
          <Select id="deactivateAction" value={deactivateAction} onChange={(e) => setDeactivateAction(e.target.value as typeof deactivateAction)}>
            <option value="unassign">Return to unassigned queue</option>
            <option value="reassign">Reassign to another staff member</option>
            <option value="department">Leave with department (no per-record change)</option>
          </Select>
        </Field>
        {deactivateAction === "reassign" && (
          <Field label="Reassign to" htmlFor="reassignTo">
            <Select id="reassignTo" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">Select a staff member…</option>
              {items?.filter((a) => a.active && a.id !== deactivating?.id).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Confirm your password" htmlFor="stepUpPassword" hint="Required for this sensitive action.">
          <Input id="stepUpPassword" type="password" value={stepUpPassword} onChange={(e) => setStepUpPassword(e.target.value)} />
        </Field>
        {deactivateError && <p className="text-sm text-danger">{deactivateError}</p>}
      </ConfirmDialog>
    </div>
  );
}
