import type { SecurityEventType, SocAlertStatus, SocSeverity } from "@prisma/client";

// STEP 32 — shared shapes for the Security Operations Center.

export type { SocSeverity, SocAlertStatus };

// Who is acting: id + the permissions they hold RIGHT NOW (read from the database for anything that must not trust a login-time snapshot).
export interface SocViewer {
  id: string;
  permissions: string[];
}

export const SEVERITY_ORDER: SocSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const severityRank = (s: SocSeverity): number => SEVERITY_ORDER.indexOf(s);
export const severityAtLeast = (s: SocSeverity, floor: SocSeverity): boolean => severityRank(s) >= severityRank(floor);

// The tunable part of a rule. Everything else about a rule lives in code, so a version row can never change what a rule MEANS.
export interface RuleConfig {
  enabled: boolean;
  severity: SocSeverity;
  threshold: number; // count (or distinct count) that must be reached inside one window
  windowMinutes: number;
}

// What a rule reads. Closed set: a rule can only ask for these shapes, never for arbitrary data.
export type RuleQuery =
  | { kind: "events"; types: SecurityEventType[]; groupBy: "adminId" | "ipHash" | "subjectKey" | "profileId"; distinctBy?: "adminId" | "ipHash" | "subjectKey" | "profileId"; outcomes?: string[]; providerFromMeta?: boolean }
  | { kind: "aiDenied" }
  | { kind: "backupFailed" };

export interface RuleDefinition {
  key: string;
  name: string;
  category: string; // maps onto an incident category suggestion
  description: string;
  source: string; // the table(s) the rule reads, shown on the rule screen
  title: string; // neutral alert title — never accuses a person
  unit: string; // what is being counted, e.g. "failed sign-ins"
  query: RuleQuery;
  defaults: RuleConfig;
  // true for rules whose weakening (disable / lower severity / higher threshold / shorter window) needs a second reviewer
  protectedRule: boolean;
}

// One thing seen: a time, and optionally the distinct key it counts under, and a pointer to the record it came from.
export interface Point {
  t: number;
  key?: string;
  ref?: string;
}

export interface Observation {
  subject: string; // dedup identity, e.g. "adminId:abc"
  resource: string; // reference only, e.g. "ADMIN:abc", "NETWORK:<hash>", "WEBHOOK:payments-stripe", "SYSTEM:backup"
  points: Point[];
}

export interface Finding {
  subject: string;
  resource: string;
  observed: number;
  windowStart: number;
  windowEnd: number;
  summary: string; // safe text: counts and windows only
  evidence: Array<{ type: string; id: string }>;
}

export interface DetectionSummary {
  trigger: "SCHEDULED" | "MANUAL";
  from: string;
  to: string;
  rulesEvaluated: number;
  findings: number;
  alertsCreated: number;
  alertsRepeated: number;
  alertsSuppressed: number;
  truncated: string[]; // rules whose source read hit the row cap, so the figure may be an under-count
  errors: string[];
}
