"use client";

import { useEffect, useState } from "react";
import { Loader2, Globe2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";

interface Jurisdiction {
  id: string;
  jurisdictionCode: string;
  countryCode: string;
  regionCode: string | null;
  name: string;
  status: string;
}

const STATUSES = ["DRAFT", "ACTIVE", "INACTIVE"];

export default function JurisdictionsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<Jurisdiction[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [jurisdictionCode, setJurisdictionCode] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [regionCode, setRegionCode] = useState("");
  const [name, setName] = useState("");

  function load() {
    fetch("/api/admin/compliance/jurisdictions")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function create() {
    const res = await fetch("/api/admin/compliance/jurisdictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jurisdictionCode, countryCode, regionCode: regionCode || undefined, name, configuration: {} }),
    });
    if (res.ok) {
      show("Jurisdiction created as DRAFT", "success");
      setCreating(false);
      setJurisdictionCode("");
      setCountryCode("");
      setRegionCode("");
      setName("");
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      show(body.error ?? "Could not create jurisdiction.", "error");
    }
  }

  async function setStatus(id: string, status: string) {
    const res = await fetch(`/api/admin/compliance/jurisdictions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      show("Jurisdiction updated", "success");
      load();
    } else {
      show("Could not update jurisdiction.", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Jurisdictions</h1>
          <p className="text-sm text-muted">
            No jurisdiction is pre-configured — every one here is deliberately added by an admin. An unconfigured country always resolves to
            REVIEW_REQUIRED, never a guess.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          Add Jurisdiction
        </Button>
      </div>

      <Card>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Globe2} title="No jurisdictions configured yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="p-3">Code</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Country / Region</th>
                    <th className="p-3">Status</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((j) => (
                    <tr key={j.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-mono text-xs">{j.jurisdictionCode}</td>
                      <td className="p-3">{j.name}</td>
                      <td className="p-3 text-muted">
                        {j.countryCode}
                        {j.regionCode ? ` / ${j.regionCode}` : ""}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="p-3">
                        <Select value={j.status} onChange={(e) => setStatus(j.id, e.target.value)} className="w-32">
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={creating}
        title="Add Jurisdiction"
        description="Starts as DRAFT — set it ACTIVE only once its rules are reviewed."
        confirmLabel="Create"
        onConfirm={create}
        onCancel={() => setCreating(false)}
      >
        <Field label="Jurisdiction code (e.g. PK, US-CA, EU)" htmlFor="jrsd-code">
          <Input id="jrsd-code" value={jurisdictionCode} onChange={(e) => setJurisdictionCode(e.target.value)} />
        </Field>
        <Field label="Country code" htmlFor="jrsd-country">
          <Input id="jrsd-country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} />
        </Field>
        <Field label="Region code (optional)" htmlFor="jrsd-region">
          <Input id="jrsd-region" value={regionCode} onChange={(e) => setRegionCode(e.target.value)} />
        </Field>
        <Field label="Name" htmlFor="jrsd-name">
          <Input id="jrsd-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
