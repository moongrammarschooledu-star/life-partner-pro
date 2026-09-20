// Shared helpers for the smoke / security / load scripts.

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

export function baseUrl(args) {
  const raw = args.url || process.env.BASE_URL || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export async function http(url, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), ...init });
    const text = await res.text().catch(() => "");
    return { status: res.status, headers: res.headers, text, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, headers: new Headers(), text: String(error?.message ?? error), ms: Date.now() - started, error: true };
  }
}

// Posts the run result to the deployed app so Production Readiness can show it
// (only when CI_EVIDENCE_TOKEN + a commit SHA are available). Never sends any
// response bodies — only pass/fail and counts.
export async function reportEvidence({ kind, passed, summary, url }) {
  const token = process.env.CI_EVIDENCE_TOKEN;
  const sha = process.env.COMMIT_SHA || process.env.GITHUB_SHA;
  const target = process.env.EVIDENCE_URL || url;
  if (!token || !sha || !target) {
    console.log("(evidence not reported: CI_EVIDENCE_TOKEN / commit SHA / target URL not all set)");
    return;
  }
  const res = await http(`${target.replace(/\/$/, "")}/api/internal/ci-evidence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, status: passed ? "PASS" : "FAIL", commitSha: sha, summary }),
  });
  console.log(`evidence ${kind}: ${res.status === 200 ? "recorded" : `NOT recorded (HTTP ${res.status})`}`);
}

export function printResults(title, results) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
  for (const r of results) {
    const mark = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : r.status === "WARN" ? "!" : "·";
    console.log(`${mark} [${r.status}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\nPASS ${count("PASS")} · FAIL ${count("FAIL")} · WARN ${count("WARN")} · NOT_RUN ${count("NOT_RUN")}`);
}
