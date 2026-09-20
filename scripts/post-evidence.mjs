#!/usr/bin/env node
/**
 * Posts one CI stage result to the deployed app's evidence endpoint
 * (STEP 15 §22/§49). Used by .github/workflows/*.yml:
 *
 *   node scripts/post-evidence.mjs BUILD success
 *
 * Needs CI_EVIDENCE_TOKEN, EVIDENCE_URL and COMMIT_SHA (or GITHUB_SHA). If any
 * is missing it prints a notice and exits 0 — evidence simply won't exist, so
 * Production Readiness will (correctly) keep that gate BLOCKED.
 */
import { reportEvidence } from "./lib/evidence.mjs";

const [kind, outcome] = process.argv.slice(2);
if (!kind || !outcome) {
  console.error("usage: post-evidence.mjs <KIND> <success|failure|...>");
  process.exit(1);
}
await reportEvidence({ kind, passed: outcome === "success", url: process.env.EVIDENCE_URL, summary: { source: "github-actions", run: process.env.GITHUB_RUN_ID ?? null } });
