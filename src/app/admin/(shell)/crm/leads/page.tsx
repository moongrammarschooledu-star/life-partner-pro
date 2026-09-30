"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, UserPlus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, Input, Field } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";
import { timeAgo } from "@/components/admin/system/shared";

interface LeadRow {
  id: string;
  leadCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  assignedStaffId: string | null;
  createdAt: string;
}

const LEAD_SOURCES = ["WEBSITE", "SOCIAL_MEDIA", "FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "WHATSAPP", "REFERRAL", "FAMILY_REFERRAL", "STAFF_REFERRAL", "DIRECT", "AD_CAMPAIGN", "EVENT", "OTHER"];

export default function CrmLeadsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<LeadRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("WEBSITE");
  const [saving, setSaving] = useState(false);

  function load() {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/admin/crm/leads${qs}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }

  useEffect(load, [statusFilter]);

  async function createLead() {
    if (!fullName.trim()) return show("A name is required.", "error");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email: email || undefined, phone: phone || undefined, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create lead");
      show("Lead created.", "success");
      setFullName(""); setEmail(""); setPhone(""); setShowForm(false);
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed to create lead", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/crm" className="text-muted hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="font-heading text-2xl font-semibold">Leads</h1>
            <p className="text-sm text-muted">Pre-registration intake — convert a lead to a CRM record once it becomes a real applicant account.</p>
          </div>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "New Lead"}</Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
            <Field label="Source">
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}
              </Select>
            </Field>
            <Field label="Email (optional)"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Phone (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </div>
          <Button onClick={createLead} disabled={saving}>{saving ? "Saving…" : "Create Lead"}</Button>
        </div>
      )}

      <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
        <option value="">All statuses</option>
        {["NEW", "CONTACTED", "RESPONDED", "QUALIFICATION_PENDING", "QUALIFIED", "DUPLICATE_REVIEW_REQUIRED", "CONVERTED", "NOT_INTERESTED", "DO_NOT_CONTACT", "ARCHIVED"].map((s) => (
          <option key={s} value={s}>{formatEnumLabel(s)}</option>
        ))}
      </Select>

      {items === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={UserPlus} title="No leads yet" description="Leads captured before registration appear here." />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Lead Code</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Contact</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-2 font-medium">{l.leadCode}</td>
                    <td className="py-2">{l.fullName}</td>
                    <td className="py-2 text-muted">{l.email ?? l.phone ?? "—"}</td>
                    <td className="py-2">{formatEnumLabel(l.source)}</td>
                    <td className="py-2"><Badge variant={l.status === "CONVERTED" ? "success" : l.status === "DUPLICATE_REVIEW_REQUIRED" ? "warning" : "info"}>{formatEnumLabel(l.status)}</Badge></td>
                    <td className="py-2 text-muted">{timeAgo(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
