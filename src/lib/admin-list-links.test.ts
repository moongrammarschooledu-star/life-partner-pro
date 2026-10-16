import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// The menu's "New Profiles" / "All Profiles" / "Verified Profiles" are links to ONE page with different queries. A list that reads its filters from the address only when it
// is first built stays on the old filters when only the query changes (the page looks stuck until the person goes to the Dashboard and back). Each such page must therefore
// restart whenever the query changes.

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("admin lists that are seeded from the address restart when the link changes", () => {
  for (const [page, inner] of [
    ["src/app/admin/(shell)/profiles/page.tsx", "ProfilesList"],
    ["src/app/admin/(shell)/proposals/page.tsx", "ProposalsList"],
  ] as const) {
    it(page, () => {
      const source = read(page);
      expect(source).toMatch(new RegExp(`export default function \\w+\\(\\) \\{\\s*const searchParams = useSearchParams\\(\\);\\s*return <${inner} key=\\{searchParams\\.toString\\(\\)\\} />;`));
      // the list itself is no longer the default export
      expect(source).toMatch(new RegExp(`\\nfunction ${inner}\\(\\)`));
    });
  }
});
