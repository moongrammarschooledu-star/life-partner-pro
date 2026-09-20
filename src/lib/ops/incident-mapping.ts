import type { AlertSeverity, CaseCategory, CasePriority } from "@prisma/client";

// Pure mapping from an alert category to the Step 12 Case category / priority
// used when an alert is escalated into an incident (spec §39/§40).

export function incidentCategoryFor(alertCategory: string): CaseCategory {
  if (/^DATABASE/.test(alertCategory) || alertCategory === "DB_CAPACITY") return "DATABASE_FAILURE";
  if (/STORAGE|FILE_CAPACITY/.test(alertCategory)) return "STORAGE_FAILURE";
  if (/BACKUP|RESTORE/.test(alertCategory)) return "BACKUP_FAILURE";
  if (/DEPLOYMENT/.test(alertCategory)) return "DEPLOYMENT_FAILURE";
  if (/WEBHOOK/.test(alertCategory)) return "WEBHOOK_FAILURE";
  if (/PAYMENT/.test(alertCategory)) return "PROVIDER_OUTAGE";
  if (/RECONCILIATION/.test(alertCategory)) return "RECONCILIATION_MISMATCH";
  if (/LOGIN|PERMISSION|SECURITY/.test(alertCategory)) return "SECURITY_BREACH";
  if (/INTEGRITY/.test(alertCategory)) return "DATA_INTEGRITY_INCIDENT";
  if (/QUEUE|DEAD_LETTER|NOTIFICATION/.test(alertCategory)) return "NOTIFICATION_INCIDENT";
  return "APPLICATION_OUTAGE";
}

export function incidentPriorityFor(severity: AlertSeverity): CasePriority {
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "HIGH") return "HIGH";
  return "NORMAL";
}
