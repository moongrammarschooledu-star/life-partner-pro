import { RUNBOOKS } from "@/lib/ops/runbooks";
import { requirePagePermission } from "@/lib/page-guard";

// Operations → Runbooks (spec §55). Static, server-rendered content from the
// single source in src/lib/ops/runbooks.ts.
export default async function RunbooksPage() {
  await requirePagePermission("system:view");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Operational Runbooks</h1>
        <p className="text-sm text-muted">Detection, checks, authorised actions, verification, recovery and audit requirements for every major operational event. Steps marked (manual) happen in Vercel / Neon / GitHub — this system does not pretend to automate them.</p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm">
        {RUNBOOKS.map((r) => <a key={r.id} href={`#${r.id}`} className="rounded-full bg-surface-muted px-3 py-1 text-muted hover:text-foreground">{r.title}</a>)}
      </nav>
      {RUNBOOKS.map((r) => (
        <section key={r.id} id={r.id} className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-surface p-5">
          <div>
            <h2 className="font-heading text-lg font-semibold">{r.title}</h2>
            <p className="text-sm text-muted">{r.summary}</p>
          </div>
          {([["Detection", r.detection], ["Checks", r.checks], ["Authorised actions", r.authorizedActions], ["Verification", r.verification], ["Recovery", r.recovery], ["Audit requirements", r.audit]] as const).map(([label, items]) => (
            <div key={label}>
              <h3 className="text-sm font-medium">{label}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">{items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
