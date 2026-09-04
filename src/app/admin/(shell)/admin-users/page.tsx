"use client";

import { useEffect, useState } from "react";
import { Loader2, UserPlus, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "STAFF" | "VIEWER";
  active: boolean;
  createdAt: string;
  lastLogin: string | null;
}

const ROLES = ["SUPER_ADMIN", "ADMIN", "STAFF", "VIEWER"];

export default function AdminUsersPage() {
  const { show } = useToast();
  const [items, setItems] = useState<AdminUserRow[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("STAFF");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
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
        body: JSON.stringify({ name, email, password, role }),
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
      load();
    } finally {
      setCreating(false);
    }
  }

  async function updateAdmin(id: string, data: { role?: string; active?: boolean }) {
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
                    </td>
                    <td className="p-3 text-muted">{a.email}</td>
                    <td className="p-3">
                      <Select
                        value={a.role}
                        onChange={(e) => updateAdmin(a.id, { role: e.target.value })}
                        className="h-8 w-auto text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {formatEnumLabel(r)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3">
                      <Badge variant={a.active ? "success" : "muted"}>{a.active ? "Active" : "Deactivated"}</Badge>
                    </td>
                    <td className="p-3 text-muted">{a.lastLogin ? formatDateTime(a.lastLogin) : "Never"}</td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" onClick={() => updateAdmin(a.id, { active: !a.active })}>
                        {a.active ? "Deactivate" : "Reactivate"}
                      </Button>
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
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button className="w-full" onClick={createAdmin} disabled={creating || !name || !email || !password}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" />} Create Admin
          </Button>
        </div>
      </Modal>
    </div>
  );
}
