import { prisma } from "@/lib/prisma";

// Generic row-per-key counter shared by LPP-DEL-######/LPP-PRIV-###### codes
// (STEP 13) and LPP-PAY-/LPP-SUB-/LPP-ORD-/LPP-INV-/LPP-DISC-/LPP-PKG-/
// LPP-REF- codes (STEP 14), LPP-REL-/LPP-BKP-/LPP-ALT- codes (STEP 15),
// LPP-TASK- codes (STEP 18), LPP-APR- codes (STEP 19), and LPP-SRCH-/
// LPP-SHORT- codes (STEP 20) — mirrors src/lib/case-code.ts's exact
// atomic-upsert pattern with a reusable key instead of many near-identical
// single-purpose tables.
export type SequencePrefix =
  | "SEC-ALERT" // STEP 32 — SOC security alerts (LPP-SEC-ALERT-######)
  | "KPI" // STEP 31 — analytics KPIs (LPP-KPI-######)
  | "MET" // STEP 31 — analytics metric definitions
  | "DASH" // STEP 31 — analytics dashboards
  | "DEL"
  | "PRIV"
  | "PAY"
  | "SUB"
  | "ORD"
  | "INV"
  | "DISC"
  | "PKG"
  | "REF"
  | "REL"
  | "BKP"
  | "ALT"
  | "TASK"
  | "APR"
  | "SRCH"
  | "SHORT"
  | "FAM"
  | "FAMGRP"
  | "FAMREQ"
  | "FAMDEC"
  | "DUPC"
  | "JRSD"
  | "CRULE"
  | "CREV"
  | "XFER"
  | "PROC"
  | "AGRMT"
  | "AUTHREQ"
  | "SIGNAL"
  | "RISK"
  | "REPORT"
  | "CTPL"
  | "THR"
  | "CAMP"
  | "DOC"
  | "DREQ"
  | "SIGN"
  | "DOCPKG"
  | "PKGV"
  | "CRED"
  | "PROMO"
  | "REFPR"
  | "CRM"
  | "LEAD"
  | "FUP"
  | "CRMV"
  | "MCAMP"
  | "ATTR"
  | "MCRE"
  | "LP"
  | "FORM"
  | "ENG" // STEP 30 - engagement workflow runs (LPP-ENG-######)
  | "EWF" // STEP 30 - engagement workflows
  | "ECN" // STEP 30 - guide content
  | "EAN" // STEP 30 - announcements
  | "EFB" // STEP 30 - applicant feedback
  | "ESV"; // STEP 30 - surveys

export async function nextSequenceCode(prefix: SequencePrefix): Promise<string> {
  const counter = await prisma.sequenceCounter.upsert({
    where: { key: prefix },
    update: { lastSeq: { increment: 1 } },
    create: { key: prefix, lastSeq: 1 },
  });
  return `LPP-${prefix}-${String(counter.lastSeq).padStart(6, "0")}`;
}
