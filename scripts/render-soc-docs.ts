/**
 * STEP 32 — renders the parts of the Security Operations documents that must never drift from the code:
 *   docs/THREAT_DETECTION_RULES.md   <- the rule catalog (src/lib/soc/rules/registry.ts)
 *   docs/SECURITY_OPERATIONS_CENTER.md <- the sensitive-data control matrix (src/lib/soc/control-matrix.ts)
 * Only the text between the GENERATED markers is replaced; everything else in each file is hand-written.
 *
 *   npx tsx scripts/render-soc-docs.ts          (writes)
 *   npx tsx scripts/render-soc-docs.ts --check  (exits 1 if a file is out of date — used by a test)
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { RULES } from "../src/lib/soc/rules/registry";
import { CONTROL_MATRIX } from "../src/lib/soc/control-matrix";

const check = process.argv.includes("--check");
const docs = join(__dirname, "..", "docs");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function rulesTable(): string {
  const head = "| Rule | What it counts | Reads | Starting threshold | Window | Severity | Protected |\n|---|---|---|---|---|---|---|";
  const rows = RULES.map((r) => `| \`${r.key}\` — ${cell(r.name)} | ${cell(r.description)} (${r.unit}) | ${r.source} | ${r.defaults.threshold} | ${r.defaults.windowMinutes} min | ${r.defaults.severity} | ${r.protectedRule ? "yes" : "no"} |`);
  return [head, ...rows].join("\n");
}

function matrix(): string {
  return CONTROL_MATRIX.map((c) => {
    const lines = [
      `### ${c.dataClass}`,
      `- **Where access is decided (server side):** ${c.authorization.map((a) => `\`${a}\``).join(", ")}`,
      `- **Field / record control:** ${cell(c.fieldControl)}`,
      `- **Storage:** ${cell(c.storage)}`,
      `- **How it can leave the system:** ${cell(c.exportPath)}`,
      `- **Audit trail:** ${cell(c.audited)}`,
      `- **Tests:** ${c.tests.map((t) => `\`${t}\``).join(", ")}`,
    ];
    if (c.limit) lines.push(`- **Known limit:** ${cell(c.limit)}`);
    return lines.join("\n");
  }).join("\n\n");
}

function replaceBlock(text: string, name: string, body: string): string {
  const begin = `<!-- BEGIN GENERATED:${name} -->`;
  const end = `<!-- END GENERATED:${name} -->`;
  const a = text.indexOf(begin);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`Marker ${name} not found`);
  return `${text.slice(0, a + begin.length)}\n${body}\n${text.slice(b)}`;
}

let stale = false;
for (const [file, block, body] of [
  ["THREAT_DETECTION_RULES.md", "rules", rulesTable()],
  ["SECURITY_OPERATIONS_CENTER.md", "matrix", matrix()],
] as const) {
  const path = join(docs, file);
  const current = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const next = replaceBlock(current, block, body);
  if (next !== current) {
    stale = true;
    if (!check) writeFileSync(path, next);
  }
}
if (check && stale) {
  console.error("docs are out of date: run `npx tsx scripts/render-soc-docs.ts`");
  process.exit(1);
}
console.log(check ? "docs are current" : stale ? "docs updated" : "docs already current");
