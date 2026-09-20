/** Renders src/lib/ops/runbooks.ts (single source) into docs/RUNBOOKS.md. Run: npx tsx scripts/render-runbooks.ts */
import { writeFileSync } from "fs";
import { RUNBOOKS } from "../src/lib/ops/runbooks";

const sections = RUNBOOKS.map((r) => {
  const list = (title: string, items: string[]) => `### ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n`;
  return [`## ${r.title}`, r.summary, "", list("Detection", r.detection), list("Checks", r.checks), list("Authorised actions", r.authorizedActions), list("Verification", r.verification), list("Recovery", r.recovery), list("Audit requirements", r.audit)].join("\n");
});

writeFileSync(
  "docs/RUNBOOKS.md",
  `# Operational runbooks\n\n> Generated from \`src/lib/ops/runbooks.ts\` (also shown in Admin → Runbooks). Do not edit by hand — edit the source and run \`npx tsx scripts/render-runbooks.ts\`.\n\n${sections.join("\n")}`
);
console.log(`Wrote docs/RUNBOOKS.md (${RUNBOOKS.length} runbooks)`);
