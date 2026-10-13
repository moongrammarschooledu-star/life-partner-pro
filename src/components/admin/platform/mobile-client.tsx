"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { ApprovalNote, ChangeDialog, CcHeader, Source, Stat, StatusPill, Table, fmt, sendChange } from "@/components/admin/platform/cc-shared";

interface Policy { minimumSupportedVersion: string; recommendedVersion: string; latestVersion: string; storeUrl: string | null; version: number }
interface Release { id: string; platform: "ANDROID" | "IOS"; version: string; buildNumber: number; status: string; releaseNotes: string; releasedAt: string | null; createdAt: string }
interface Overview {
  environment: string;
  generatedAt: string;
  identity: { appName: string; androidPackageId: string; iosBundleId: string; hosts: string[]; appUrl: string };
  flags: Record<string, boolean> | null;
  versionPolicy: { android: Policy | null; ios: Policy | null };
  devices: { android: number | null; ios: number | null; activeLast30Days: number | null; withPushToken: number | null; tokenInvalid: number | null };
  versions: Array<{ platform: string; version: string; devices: number }> | null;
  push: { providers: { fcm: boolean; apns: boolean }; last24h: Record<string, number> | null; topReasons: Array<{ reason: string; count: number }> | null };
  deepLinks: { appLinksConfigured: boolean; universalLinksConfigured: boolean; allowedRoutes: number; last24h: Record<string, number> | null };
  security: { last24h: Record<string, number> | null };
  errors: Array<{ id: string; service: string; severity: string; route: string | null; message: string; occurrences: number; lastSeenAt: string; status: string }> | null;
  releases: Release[] | null;
  analytics: { enabled: boolean; last7DaysByEvent: Record<string, number> | null };
  recentDevices: Array<{ id: string; platform: string; appVersion: string; osVersion: string | null; ownerKind: string; lastSeenAt: string; pushEnabled: boolean; biometricEnabled: boolean }>;
  canManage: boolean;
  canPush: boolean;
  notes: string[];
}

const RELEASE_STATUSES = ["DRAFT", "INTERNAL_TESTING", "CLOSED_TESTING", "OPEN_TESTING", "PRODUCTION", "PAUSED", "RETIRED"];
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
const num = (n: number | null | undefined) => (n === null || n === undefined ? "Unavailable" : n);

export function MobileClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading, reload } = useApi<Overview>("/api/admin/platform/mobile");
  const { show } = useToast();
  const [approval, setApproval] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"version" | "release" | "move" | "test" | "remove" | null>(null);
  const [platform, setPlatform] = useState<"ANDROID" | "IOS">("ANDROID");
  const [form, setForm] = useState({ min: "", rec: "", latest: "", store: "" });
  const [rel, setRel] = useState({ platform: "ANDROID", version: "", build: "", notes: "" });
  const [moving, setMoving] = useState<{ r: Release; to: string } | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const env = data?.environment ?? "PRODUCTION";

  function openVersion(p: "ANDROID" | "IOS") {
    const pol = p === "ANDROID" ? data?.versionPolicy.android : data?.versionPolicy.ios;
    setPlatform(p);
    setForm({ min: pol?.minimumSupportedVersion ?? "1.0.0", rec: pol?.recommendedVersion ?? "1.0.0", latest: pol?.latestVersion ?? "1.0.0", store: pol?.storeUrl ?? "" });
    setDialog("version");
  }

  const policyCard = (p: "ANDROID" | "IOS") => {
    const pol = p === "ANDROID" ? data?.versionPolicy.android : data?.versionPolicy.ios;
    return (
      <div className="rounded-lg border border-border p-3 text-sm">
        <div className="flex items-center justify-between"><p className="font-medium">{p === "ANDROID" ? "Android" : "iPhone / iPad"}</p>{data?.canManage && <Button size="sm" variant="outline" onClick={() => openVersion(p)}>Change</Button>}</div>
        {pol ? (
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted">Minimum</dt><dd className="font-medium">{pol.minimumSupportedVersion}</dd></div>
            <div><dt className="text-muted">Recommended</dt><dd className="font-medium">{pol.recommendedVersion}</dd></div>
            <div><dt className="text-muted">Latest</dt><dd className="font-medium">{pol.latestVersion}</dd></div>
            <div className="col-span-3 text-muted">{pol.version === 0 ? "Default policy (nothing is blocked yet)." : `Policy version ${pol.version}`}{pol.storeUrl ? ` · ${new URL(pol.storeUrl).hostname}` : " · no store address yet"}</div>
          </dl>
        ) : <p className="mt-2 text-muted">Unavailable.</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <CcHeader title="Mobile apps" description="The Android and iPhone apps are a native shell around this website: the same sign-in, the same API and the same permissions. This page shows their versions, devices, push notification health, links and releases. It never shows a push token or a person's details." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {approval && <ApprovalNote code={approval} onClose={() => setApproval(null)} />}
      {data && (
        <>
          <Card title="App identity and switches">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div><p className="text-xs text-muted">Android package id</p><p className="font-mono">{data.identity.androidPackageId}</p></div>
              <div><p className="text-xs text-muted">iOS bundle id</p><p className="font-mono">{data.identity.iosBundleId}</p></div>
              <div className="md:col-span-2"><p className="text-xs text-muted">Pages the apps may show</p><p className="font-mono">{data.identity.hosts.join(", ") || "none configured"}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.flags ? Object.entries(data.flags).map(([k, v]) => <Badge key={k} variant={v ? "success" : "muted"}>{k.replace("mobile.", "").replace(".enabled", "")}: {v ? "on" : "off"}</Badge>) : <span className="text-sm text-muted">Switches unavailable.</span>}
            </div>
            <p className="mt-2 text-xs text-muted">Change these in <Link href="/admin/control-center/features" className="text-primary hover:underline">Feature flags</Link> (emergency disable, percentage rollout and approvals apply there).</p>
          </Card>

          <Card title="App versions">
            <div className="grid gap-3 md:grid-cols-2">{policyCard("ANDROID")}{policyCard("IOS")}</div>
            <p className="mt-2 text-xs text-muted">An app below the minimum is shown an update screen and cannot register. The update link can only be the official store page. A missing or invalid version counts as the oldest.</p>
          </Card>

          <Card title="Installed devices">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Stat label="Android" value={num(data.devices.android)} />
              <Stat label="iPhone / iPad" value={num(data.devices.ios)} />
              <Stat label="Used in last 30 days" value={num(data.devices.activeLast30Days)} />
              <Stat label="With notifications" value={num(data.devices.withPushToken)} />
              <Stat label="Dead token" value={num(data.devices.tokenInvalid)} tone={data.devices.tokenInvalid ? "warning" : undefined} />
            </div>
            {data.versions && data.versions.length > 0 && <div className="mt-3"><Table head={["Platform", "App version", "Devices"]}>{data.versions.map((v) => <tr key={`${v.platform}${v.version}`}><td className="px-2 py-1.5">{v.platform === "ANDROID" ? "Android" : "iOS"}</td><td className="px-2 py-1.5">{v.version}</td><td className="px-2 py-1.5">{v.devices}</td></tr>)}</Table></div>}
            <Source at={data.generatedAt}>MobileDevice (counts only)</Source>
          </Card>

          <Card title="Push notifications">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Android (FCM):</span><StatusPill status={data.push.providers.fcm ? "CONNECTED" : "NOT_CONFIGURED"} />
              <span className="ml-3">iPhone (APNs):</span><StatusPill status={data.push.providers.apns ? "CONNECTED" : "NOT_CONFIGURED"} />
              <span className="ml-3 text-xs text-muted">&ldquo;Connected&rdquo; means the server has the settings; it is not a delivery guarantee.</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {["SENT", "SKIPPED", "FAILED", "INVALID_TOKEN"].map((s) => <Stat key={s} label={`${label(s)} (24 h)`} value={data.push.last24h ? (data.push.last24h[s] ?? 0) : "Unavailable"} tone={s === "FAILED" && (data.push.last24h?.[s] ?? 0) > 0 ? "danger" : undefined} />)}
            </div>
            {data.push.topReasons && data.push.topReasons.length > 0 && <p className="mt-2 text-xs text-muted">Most common reasons not sent: {data.push.topReasons.map((r) => `${r.reason.replace(/_/g, " ")} (${r.count})`).join(", ")}</p>}
            <div className="mt-3">
              <Table head={["Device", "Platform", "App", "Owner", "Last used", "Notifications", ""]} empty={data.recentDevices.length === 0 ? "No devices have registered yet." : undefined}>
                {data.recentDevices.slice(0, 10).map((d) => (
                  <tr key={d.id}>
                    <td className="px-2 py-1.5 font-mono text-xs">{d.id.slice(-8)}</td>
                    <td className="px-2 py-1.5">{d.platform === "ANDROID" ? "Android" : "iOS"}</td>
                    <td className="px-2 py-1.5">{d.appVersion}</td>
                    <td className="px-2 py-1.5 text-muted">{d.ownerKind === "FAMILY" ? "family member" : "applicant"}</td>
                    <td className="px-2 py-1.5 text-muted">{fmt(d.lastSeenAt)}</td>
                    <td className="px-2 py-1.5">{d.pushEnabled ? <StatusPill status="ENABLED" /> : <StatusPill status="DISABLED" />}</td>
                    <td className="space-x-1 whitespace-nowrap px-2 py-1.5 text-right">
                      {data.canPush && d.pushEnabled && <Button size="sm" variant="outline" onClick={() => { setDevice(d.id); setDialog("test"); }}>Send test</Button>}
                      {data.canManage && <Button size="sm" variant="ghost" onClick={() => { setDevice(d.id); setDialog("remove"); }}>Remove</Button>}
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="mt-2 text-xs text-muted">A test sends one fixed, generic message to one device. There is no way to send custom text or to broadcast from here.</p>
            </div>
          </Card>

          <Card title="Links and security (last 24 hours)">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Android App Links:</span><StatusPill status={data.deepLinks.appLinksConfigured ? "CONNECTED" : "NOT_CONFIGURED"} />
              <span className="ml-3">iPhone Universal Links:</span><StatusPill status={data.deepLinks.universalLinksConfigured ? "CONNECTED" : "NOT_CONFIGURED"} />
              <span className="ml-3 text-xs text-muted">{data.deepLinks.allowedRoutes} approved routes · links open only after the server confirms the person and the record</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Links opened" value={data.deepLinks.last24h ? (data.deepLinks.last24h.ALLOWED ?? 0) : "Unavailable"} />
              <Stat label="Links refused" value={data.deepLinks.last24h ? (data.deepLinks.last24h.REFUSED ?? 0) : "Unavailable"} tone={(data.deepLinks.last24h?.REFUSED ?? 0) > 20 ? "warning" : undefined} />
              <Stat label="Mobile security events" value={data.security.last24h ? Object.values(data.security.last24h).reduce((a, b) => a + b, 0) : "Unavailable"} />
              <Stat label="Security warnings" value={data.security.last24h ? (data.security.last24h.MOBILE_SECURITY_WARNING ?? 0) : "Unavailable"} tone={(data.security.last24h?.MOBILE_SECURITY_WARNING ?? 0) > 0 ? "warning" : undefined} />
            </div>
            <p className="mt-2 text-xs text-muted">Details of mobile security events are in <Link href="/admin/security-operations" className="text-primary hover:underline">Security Operations</Link>.</p>
          </Card>

          <Card title="Releases" action={data.canManage ? <Button size="sm" onClick={() => setDialog("release")}>Record a build</Button> : undefined}>
            <Table head={["Platform", "Version (build)", "Status", "Notes", "Released", ""]} empty={(data.releases?.length ?? 0) === 0 ? "No builds recorded yet. The store console is where a release really happens; this is the record." : undefined}>
              {(data.releases ?? []).map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-2 py-1.5">{r.platform === "ANDROID" ? "Android" : "iOS"}</td>
                  <td className="px-2 py-1.5">{r.version} ({r.buildNumber})</td>
                  <td className="px-2 py-1.5"><StatusPill status={r.status === "INTERNAL_TESTING" || r.status === "CLOSED_TESTING" || r.status === "OPEN_TESTING" ? "ROLLOUT" : r.status === "PRODUCTION" ? "ENABLED" : r.status === "PAUSED" ? "PAUSED" : "DRAFT"} /> <span className="text-xs text-muted">{label(r.status)}</span></td>
                  <td className="max-w-xs px-2 py-1.5 text-xs text-muted">{r.releaseNotes}</td>
                  <td className="px-2 py-1.5 text-muted">{fmt(r.releasedAt)}</td>
                  <td className="px-2 py-1.5 text-right">{data.canManage && r.status !== "RETIRED" && <Select aria-label="Move release" className="h-8 w-44" value="" onChange={(e) => { if (e.target.value) { setMoving({ r, to: e.target.value }); setDialog("move"); } }}><option value="">Move to…</option>{RELEASE_STATUSES.filter((s) => s !== r.status).map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-xs text-muted">Moving a build to production needs a second administrator&apos;s approval when the approval policy is on.</p>
          </Card>

          {data.errors && data.errors.length > 0 && (
            <Card title="App errors (last 7 days)">
              <Table head={["App", "Severity", "Where", "What", "Times", "Last"]}>{data.errors.map((e) => <tr key={e.id}><td className="px-2 py-1.5">{e.service === "MOBILE_ANDROID" ? "Android" : "iOS"}</td><td className="px-2 py-1.5">{e.severity.toLowerCase()}</td><td className="px-2 py-1.5 font-mono text-xs">{e.route ?? "—"}</td><td className="max-w-xs px-2 py-1.5 text-xs text-muted">{e.message}</td><td className="px-2 py-1.5">{e.occurrences}</td><td className="px-2 py-1.5 text-muted">{fmt(e.lastSeenAt)}</td></tr>)}</Table>
            </Card>
          )}

          <Card title="App usage (last 7 days)">
            {!data.analytics.enabled ? <p className="text-sm text-muted">App usage counting is off. It only counts anonymous event names (no person, device or content) and is switched on with the MOBILE_ANALYTICS_ENABLED setting.</p> : data.analytics.last7DaysByEvent ? <div className="flex flex-wrap gap-2">{Object.entries(data.analytics.last7DaysByEvent).map(([k, v]) => <Badge key={k} variant="muted">{k.toLowerCase().replace(/_/g, " ")}: {v}</Badge>)}</div> : <p className="text-sm text-muted">Unavailable.</p>}
          </Card>
          <ul className="list-disc pl-5 text-xs text-muted">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}

      <ChangeDialog
        open={dialog === "version"}
        danger
        title={`App versions: ${platform === "ANDROID" ? "Android" : "iPhone / iPad"}`}
        description="Raising the minimum shows an update screen to every app below it. Check that the new version is already in the store."
        environment={env}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const r = await sendChange("/api/admin/platform/mobile/versions", "PATCH", { platform, minimumSupportedVersion: form.min, recommendedVersion: form.rec, latestVersion: form.latest, storeUrl: form.store || undefined, reason, environment, stepUpToken });
          if (r.error) return r.error;
          show("App versions saved.", "success"); setDialog(null); reload();
          return null;
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <Field label="Minimum" htmlFor="mv-min"><Input id="mv-min" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></Field>
          <Field label="Recommended" htmlFor="mv-rec"><Input id="mv-rec" value={form.rec} onChange={(e) => setForm({ ...form, rec: e.target.value })} /></Field>
          <Field label="Latest" htmlFor="mv-latest"><Input id="mv-latest" value={form.latest} onChange={(e) => setForm({ ...form, latest: e.target.value })} /></Field>
        </div>
        <Field label="Store page address (official Google Play / App Store page)" htmlFor="mv-store"><Input id="mv-store" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} placeholder="https://play.google.com/store/apps/details?id=…" /></Field>
      </ChangeDialog>

      <ChangeDialog
        open={dialog === "release"}
        title="Record a build"
        description="This only records the build in this log. Publishing happens in the Play Console or App Store Connect."
        environment={env}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const r = await sendChange("/api/admin/platform/mobile/releases", "POST", { platform: rel.platform, version: rel.version, buildNumber: Number(rel.build), releaseNotes: rel.notes, reason, environment, stepUpToken });
          if (r.error) return r.error;
          show("Build recorded.", "success"); setDialog(null); setRel({ platform: "ANDROID", version: "", build: "", notes: "" }); reload();
          return null;
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <Field label="Platform" htmlFor="rl-p"><Select id="rl-p" value={rel.platform} onChange={(e) => setRel({ ...rel, platform: e.target.value })}><option value="ANDROID">Android</option><option value="IOS">iOS</option></Select></Field>
          <Field label="Version" htmlFor="rl-v"><Input id="rl-v" value={rel.version} onChange={(e) => setRel({ ...rel, version: e.target.value })} placeholder="1.0.0" /></Field>
          <Field label="Build number" htmlFor="rl-b"><Input id="rl-b" type="number" value={rel.build} onChange={(e) => setRel({ ...rel, build: e.target.value })} /></Field>
        </div>
        <Field label="Release notes" htmlFor="rl-n"><Textarea id="rl-n" maxLength={2000} value={rel.notes} onChange={(e) => setRel({ ...rel, notes: e.target.value })} /></Field>
      </ChangeDialog>

      <ChangeDialog
        open={dialog === "move" && moving !== null}
        danger={moving?.to === "PRODUCTION"}
        title={moving ? `Move ${moving.r.version} (${moving.r.buildNumber}) to ${label(moving.to)}` : "Move release"}
        description={moving?.to === "PRODUCTION" ? "Production needs a second administrator's approval when the approval policy is on." : "The move is recorded with your reason."}
        environment={env}
        onCancel={() => { setDialog(null); setMoving(null); }}
        submit={async ({ reason, stepUpToken, environment }) => {
          if (!moving) return null;
          const r = await sendChange(`/api/admin/platform/mobile/releases/${moving.r.id}`, "PATCH", { status: moving.to, reason, environment, stepUpToken });
          if (r.error) return r.error;
          if (r.approvalCode) setApproval(r.approvalCode); else show("Release updated.", "success");
          setDialog(null); setMoving(null); reload();
          return null;
        }}
      />

      <ChangeDialog
        open={dialog === "test"}
        title="Send a test notification"
        description="One fixed, generic message goes to this device. Nothing about any person is included."
        environment={env}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const r = await sendChange("/api/admin/platform/mobile/push-test", "POST", { deviceId: device, reason, environment, stepUpToken });
          if (r.error) return r.error;
          show("Test requested. Check the delivery counts above.", "success"); setDialog(null); reload();
          return null;
        }}
      />

      <ChangeDialog
        open={dialog === "remove"}
        danger
        title="Remove this device"
        description="Its notifications stop and the sign-in it used is ended. The person can sign in again."
        environment={env}
        onCancel={() => setDialog(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          const r = await sendChange(`/api/admin/platform/mobile/devices/${device}/remove`, "POST", { reason, environment, stepUpToken });
          if (r.error) return r.error;
          show("Device removed.", "success"); setDialog(null); reload();
          return null;
        }}
      />
    </div>
  );
}
