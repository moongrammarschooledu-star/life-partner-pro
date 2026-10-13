import { PageShell, PageHeading, Section } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";
import { getPublicStatus } from "@/lib/platform/status";
import type { PublicStatus } from "@/lib/platform/status";

export const metadata = pageMetadata("/status");
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { MAINTENANCE: "Maintenance", SECURITY_NOTICE: "Notice", SERVICE_INTERRUPTION: "Service interruption", PLATFORM_UPDATE: "Update" };
const TONE: Record<string, string> = { OPERATIONAL: "border-success/40 bg-success/10", SCHEDULED_MAINTENANCE: "border-warning/40 bg-warning/10", MAINTENANCE: "border-warning/40 bg-warning/10", READ_ONLY: "border-warning/40 bg-warning/10", DISRUPTION: "border-danger/40 bg-danger/10" };

function when(v: string | null, tz: string): string {
  if (!v) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz || "UTC" }).format(new Date(v));
  } catch {
    return new Date(v).toISOString();
  }
}

// The public status page. It shows only what getPublicStatus returns: an overall state, planned maintenance and notices an administrator chose to publish. No
// internal address, provider, error, incident or person is ever part of that payload.
export default async function StatusPage() {
  let status: PublicStatus | null = null;
  try {
    status = await getPublicStatus();
  } catch {
    status = null;
  }
  return (
    <PageShell path="/status" title="Status" description="Platform status and service notices." width="max-w-2xl">
      <PageHeading title="Platform status" lead="Whether the platform is running normally, and any planned maintenance or notices." />
      {!status ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted" role="status">The current status could not be read just now. Please try again in a minute.</p>
      ) : !status.enabled ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted" role="status">The status page is not switched on.</p>
      ) : (
        <>
          <div role="status" className={`rounded-xl border p-5 ${TONE[status.state] ?? "border-border bg-surface"}`}>
            <p className="text-lg font-semibold">{status.headline}</p>
            {status.message && <p className="mt-1 text-sm">{status.message}</p>}
            <p className="mt-2 text-xs text-muted">Updated {when(status.generatedAt, status.timezone)}{status.timezone ? ` (${status.timezone})` : ""}</p>
          </div>
          {status.scheduledMaintenance.length > 0 && (
            <Section title="Planned maintenance">
              <ul className="space-y-3">
                {status.scheduledMaintenance.map((m, i) => (
                  <li key={i} className="rounded-xl border border-border bg-surface p-4 text-sm">
                    <p className="font-medium">{m.title}</p>
                    <p className="mt-1 text-muted">{m.message}</p>
                    {(m.startsAt || m.endsAt) && <p className="mt-1 text-xs text-muted">{m.startsAt ? when(m.startsAt, status.timezone) : "Now"}{m.endsAt ? ` to ${when(m.endsAt, status.timezone)}` : ""}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Notices">
            {status.notices.length === 0 ? (
              <p className="text-sm text-muted">There are no notices right now.</p>
            ) : (
              <ul className="space-y-3">
                {status.notices.map((n, i) => (
                  <li key={i} className="rounded-xl border border-border bg-surface p-4 text-sm">
                    <p className="font-medium">{n.title} <span className="ml-1 text-xs font-normal text-muted">{KIND_LABEL[n.kind] ?? n.kind}{n.resolved ? " · resolved" : ""}</span></p>
                    <p className="mt-1 text-muted">{n.message}</p>
                    <p className="mt-1 text-xs text-muted">{when(n.startedAt, status.timezone)}{n.resolvedAt ? ` · resolved ${when(n.resolvedAt, status.timezone)}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {(status.contact.email || status.contact.hours) && (
            <Section title="Need help?">
              <p className="text-sm text-muted">{status.contact.email ? <>Write to <a className="underline" href={`mailto:${status.contact.email}`}>{status.contact.email}</a>.</> : null} {status.contact.hours ? `Support hours: ${status.contact.hours}.` : null}</p>
            </Section>
          )}
        </>
      )}
    </PageShell>
  );
}