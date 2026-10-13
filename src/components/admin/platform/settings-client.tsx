"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { ApprovalNote, ChangeDialog, CcHeader, fmt, sendChange } from "@/components/admin/platform/cc-shared";

interface SettingItem {
  key: string;
  label: string;
  description: string;
  category: "identity" | "localization" | "contact" | "branding" | "status";
  type: string;
  enumValues: string[] | null;
  maxLength: number | null;
  allowEmpty: boolean;
  risk: "LOW" | "HIGH";
  appliedBy: string[];
  value: unknown;
  version: number;
  isDefault: boolean;
  updatedAt: string | null;
}
interface SettingsResponse { environment: string; items: SettingItem[]; canManage: { settings: boolean; branding: boolean } }

const CATEGORY_TITLE: Record<string, string> = { identity: "Identity", localization: "Language, country and time", contact: "Public contact details", branding: "Branding", status: "Status page" };

const asText = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// One settings page. `categories` chooses which groups the page shows (platform, localization, branding), so each page lists only its own settings.
export function SettingsClient({ permissions, categories, title, description }: { permissions: string[]; categories: Array<SettingItem["category"]>; title: string; description: string }) {
  const { data, error, loading, reload } = useApi<SettingsResponse>("/api/admin/platform/settings");
  const { show } = useToast();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<SettingItem | null>(null);
  const approval = useState<string | null>(null);
  const items = (data?.items ?? []).filter((i) => categories.includes(i.category));
  const canEdit = (i: SettingItem) => (i.category === "branding" || i.category === "contact" ? data?.canManage.branding : data?.canManage.settings);

  function parse(item: SettingItem, raw: string): unknown {
    if (item.type === "BOOLEAN") return raw === "true";
    if (item.type === "INTEGER" || item.type === "DECIMAL") return Number(raw);
    if (item.type === "JSON") { try { return JSON.parse(raw); } catch { return raw; } }
    return raw;
  }

  return (
    <div className="space-y-4">
      <CcHeader title={title} description={description} permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {approval[0] && <ApprovalNote code={approval[0]} onClose={() => approval[1](null)} />}
      {data && categories.map((c) => {
        const group = items.filter((i) => i.category === c);
        if (group.length === 0) return null;
        return (
          <Card key={c} title={CATEGORY_TITLE[c]}>
            <div className="space-y-5">
              {group.map((i) => {
                const current = edit[i.key] ?? asText(i.value);
                const changed = edit[i.key] !== undefined && edit[i.key] !== asText(i.value);
                const editable = Boolean(canEdit(i));
                return (
                  <div key={i.key} className="border-b border-border pb-4 last:border-0 last:pb-0">
                    <Field label={i.label} hint={i.description} htmlFor={`s-${i.key}`}>
                      {i.type === "BOOLEAN" ? (
                        <Select id={`s-${i.key}`} disabled={!editable} value={current} onChange={(e) => setEdit({ ...edit, [i.key]: e.target.value })}><option value="true">On</option><option value="false">Off</option></Select>
                      ) : i.type === "ENUM" && i.enumValues ? (
                        <Select id={`s-${i.key}`} disabled={!editable} value={current} onChange={(e) => setEdit({ ...edit, [i.key]: e.target.value })}>{i.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}</Select>
                      ) : i.maxLength && i.maxLength > 150 ? (
                        <Textarea id={`s-${i.key}`} disabled={!editable} maxLength={i.maxLength} value={current} onChange={(e) => setEdit({ ...edit, [i.key]: e.target.value })} />
                      ) : (
                        <Input id={`s-${i.key}`} disabled={!editable} maxLength={i.maxLength ?? undefined} value={current} onChange={(e) => setEdit({ ...edit, [i.key]: e.target.value })} />
                      )}
                    </Field>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{i.isDefault ? "Default value" : `Version ${i.version} · changed ${fmt(i.updatedAt)}`}</span>
                      {i.appliedBy.length > 0 ? <Badge variant="info">Used by: {i.appliedBy.join(", ")}</Badge> : <Badge variant="muted">Recorded as the official value; no screen reads it yet</Badge>}
                      {i.risk === "HIGH" && <Badge variant="warning">High risk: needs approval</Badge>}
                    </div>
                    {editable && changed && <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => setConfirm(i)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit((e) => { const n = { ...e }; delete n[i.key]; return n; })}>Discard</Button></div>}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      {data && items.length === 0 && <p className="text-sm text-muted">Your role cannot view these settings.</p>}
      <ChangeDialog
        open={confirm !== null}
        title={confirm ? `Change “${confirm.label}”` : "Change setting"}
        description="The new value is saved as a new version, the old one stays in the history, and the change is recorded in the audit log."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setConfirm(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          if (!confirm) return null;
          const res = await sendChange(`/api/admin/platform/settings/${encodeURIComponent(confirm.key)}`, "PATCH", { value: parse(confirm, edit[confirm.key] ?? ""), reason, environment, stepUpToken });
          if (res.error) return res.error;
          if (res.approvalCode) approval[1](res.approvalCode);
          else show("Setting saved.", "success");
          setEdit((e) => { const n = { ...e }; delete n[confirm.key]; return n; });
          setConfirm(null);
          reload();
          return null;
        }}
      />
    </div>
  );
}
