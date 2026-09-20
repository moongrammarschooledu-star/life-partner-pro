import { describe, it, expect } from "vitest";
import { evaluatePublicState, isMaintenanceActive, isExemptFromMaintenance, DEFAULT_MAINTENANCE_MESSAGE } from "./system-state";
import { evaluateAlertRules, type MetricsSnapshot, type AlertThresholds } from "./alert-rules";
import { incidentCategoryFor, incidentPriorityFor } from "./incident-mapping";
import { backoffMs, nextStatusAfterFailure, canRetry, canCancel } from "./job-policy";
import { assessRollback } from "./rollback";
import { parseControlUpdate, sectionRequiresReauth, SECTION_PERMISSION } from "./control-schema";
import { validateUpload, detectFileType, safeFilename, contentDisposition } from "./upload-validation";
import { FEATURE_FLAG_DEFAULTS, isKnownFeatureFlag } from "./feature-flag-defs";
import { pairEligibilityProblem, profileExclusionReason } from "@/lib/matching-eligibility";

const base = { operationalState: "NORMAL", maintenanceMode: "OFF", maintenanceStartsAt: null, maintenanceEndsAt: null, maintenanceMessage: null, emergencyPublicAccessDisabled: false } as const;

describe("maintenance / emergency state", () => {
  it("is open by default", () => {
    expect(evaluatePublicState({ ...base }).blocked).toBe(false);
  });
  it("blocks with the neutral default message when maintenance is ON", () => {
    const s = evaluatePublicState({ ...base, maintenanceMode: "ON" });
    expect(s).toMatchObject({ blocked: true, reason: "MAINTENANCE", message: DEFAULT_MAINTENANCE_MESSAGE });
  });
  it("uses a custom message when provided", () => {
    expect(evaluatePublicState({ ...base, maintenanceMode: "ON", maintenanceMessage: "Back at 5" }).message).toBe("Back at 5");
  });
  it("respects a scheduled window", () => {
    const start = new Date("2026-01-01T10:00:00Z");
    const end = new Date("2026-01-01T12:00:00Z");
    const cfg = { maintenanceMode: "SCHEDULED" as const, maintenanceStartsAt: start, maintenanceEndsAt: end };
    expect(isMaintenanceActive(cfg, new Date("2026-01-01T09:59:00Z"))).toBe(false);
    expect(isMaintenanceActive(cfg, new Date("2026-01-01T11:00:00Z"))).toBe(true);
    expect(isMaintenanceActive(cfg, new Date("2026-01-01T12:00:00Z"))).toBe(false);
  });
  it("EMERGENCY state or the public-access switch blocks", () => {
    expect(evaluatePublicState({ ...base, operationalState: "EMERGENCY" }).reason).toBe("EMERGENCY");
    expect(evaluatePublicState({ ...base, emergencyPublicAccessDisabled: true }).blocked).toBe(true);
  });
  it("keeps admin, auth, health, webhooks and cron reachable", () => {
    for (const p of ["/admin/login", "/api/admin/system/control", "/api/auth/session", "/api/health/ready", "/api/webhooks/payments/stripe", "/api/cron/notifications", "/api/system-state", "/maintenance"]) {
      expect(isExemptFromMaintenance(p)).toBe(true);
    }
    for (const p of ["/", "/register", "/api/register", "/my-billing"]) expect(isExemptFromMaintenance(p)).toBe(false);
  });
});

const healthy: MetricsSnapshot = {
  dbOk: true, dbLatencyMs: 20, serverErrorsLastHour: 0, storageErrorsLastHour: 0, permissionViolationsLastHour: 0, failedAdminLoginsLastHour: 0,
  failedPaymentsLast24h: 0, failedWebhooksLast24h: 0, reconciliationMismatches: 0, queueBacklog: 0, deadLetterJobs: 0, cronConsecutiveFailures: 0,
  backupsEnabled: true, lastSuccessfulBackupAgeHours: 5, lastBackupFailed: false, lastRestoreTestStatus: "PASSED", lastRestoreTestAgeDays: 2,
  dbSizeMb: 10, fileStorageMb: 10, configCritical: false,
};
const thresholds: AlertThresholds = {
  apiLatencyWarnMs: 2000, errorRateWarnPerHour: 50, failedLoginSpikeThreshold: 10, paymentFailureSpikeThreshold: 5, webhookFailureSpikeThreshold: 5,
  queueBacklogThreshold: 100, permissionViolationThreshold: 30, dbStorageLimitMb: 100, fileStorageLimitMb: 100, capacityWarnPercent: 80,
  backupStaleAfterHours: 48, restoreTestStaleAfterDays: 30,
};

describe("alert rules", () => {
  it("raises nothing for a healthy snapshot", () => {
    expect(evaluateAlertRules(healthy, thresholds)).toEqual([]);
  });
  it("raises CRITICAL for a database outage and a failed backup", () => {
    const out = evaluateAlertRules({ ...healthy, dbOk: false, lastBackupFailed: true }, thresholds);
    expect(out.find((a) => a.category === "DATABASE_OUTAGE")?.severity).toBe("CRITICAL");
    expect(out.find((a) => a.category === "BACKUP_FAILURE")?.severity).toBe("CRITICAL");
  });
  it("raises threshold-based alerts only at/above the threshold", () => {
    expect(evaluateAlertRules({ ...healthy, serverErrorsLastHour: 49 }, thresholds).some((a) => a.category === "ERROR_RATE")).toBe(false);
    expect(evaluateAlertRules({ ...healthy, serverErrorsLastHour: 50 }, thresholds).some((a) => a.category === "ERROR_RATE")).toBe(true);
    expect(evaluateAlertRules({ ...healthy, failedAdminLoginsLastHour: 10 }, thresholds).some((a) => a.category === "FAILED_LOGIN_SPIKE")).toBe(true);
  });
  it("flags stale/absent backups and stale restore tests, but not when backups are disabled", () => {
    expect(evaluateAlertRules({ ...healthy, lastSuccessfulBackupAgeHours: null }, thresholds).some((a) => a.category === "BACKUP_STALE")).toBe(true);
    expect(evaluateAlertRules({ ...healthy, lastSuccessfulBackupAgeHours: 100 }, thresholds).some((a) => a.category === "BACKUP_STALE")).toBe(true);
    expect(evaluateAlertRules({ ...healthy, lastRestoreTestAgeDays: 45 }, thresholds).some((a) => a.category === "RESTORE_TEST_STALE")).toBe(true);
    expect(evaluateAlertRules({ ...healthy, backupsEnabled: false, lastSuccessfulBackupAgeHours: null, lastRestoreTestAgeDays: null }, thresholds)).toEqual([]);
  });
  it("warns before capacity limits", () => {
    const out = evaluateAlertRules({ ...healthy, dbSizeMb: 85 }, thresholds);
    expect(out.find((a) => a.category === "DB_CAPACITY")?.severity).toBe("HIGH");
    expect(evaluateAlertRules({ ...healthy, dbSizeMb: 97 }, thresholds).find((a) => a.category === "DB_CAPACITY")?.severity).toBe("CRITICAL");
  });
  it("uses stable dedup keys", () => {
    const a = evaluateAlertRules({ ...healthy, dbOk: false }, thresholds)[0];
    const b = evaluateAlertRules({ ...healthy, dbOk: false }, thresholds)[0];
    expect(a.dedupKey).toBe(b.dedupKey);
  });
});

describe("incident mapping", () => {
  it("maps alert categories to Step 12 incident categories", () => {
    expect(incidentCategoryFor("DATABASE_OUTAGE")).toBe("DATABASE_FAILURE");
    expect(incidentCategoryFor("BACKUP_STALE")).toBe("BACKUP_FAILURE");
    expect(incidentCategoryFor("WEBHOOK_FAILURE_SPIKE")).toBe("WEBHOOK_FAILURE");
    expect(incidentCategoryFor("FAILED_LOGIN_SPIKE")).toBe("SECURITY_BREACH");
    expect(incidentCategoryFor("ERROR_RATE")).toBe("APPLICATION_OUTAGE");
    expect(incidentCategoryFor("DEPLOYMENT_UNHEALTHY")).toBe("DEPLOYMENT_FAILURE");
  });
  it("maps severity to case priority", () => {
    expect(incidentPriorityFor("CRITICAL")).toBe("CRITICAL");
    expect(incidentPriorityFor("HIGH")).toBe("HIGH");
    expect(incidentPriorityFor("INFO")).toBe("NORMAL");
  });
});

describe("job policy", () => {
  it("backs off exponentially with a cap", () => {
    expect(backoffMs(1)).toBe(5 * 60_000);
    expect(backoffMs(2)).toBe(10 * 60_000);
    expect(backoffMs(20)).toBe(6 * 3_600_000);
  });
  it("dead-letters after the last allowed attempt", () => {
    expect(nextStatusAfterFailure(1, 3)).toEqual({ status: "RETRYING", delayMs: 5 * 60_000 });
    expect(nextStatusAfterFailure(3, 3)).toEqual({ status: "DEAD_LETTER", delayMs: null });
  });
  it("only failed/dead-letter jobs can be retried; only waiting jobs cancelled", () => {
    expect(canRetry("DEAD_LETTER")).toBe(true);
    expect(canRetry("COMPLETED")).toBe(false);
    expect(canCancel("PENDING")).toBe(true);
    expect(canCancel("RUNNING")).toBe(false);
  });
});

describe("rollback compatibility", () => {
  it("is SAFE when no migration is newer than the target", () => {
    expect(assessRollback({ currentMigrations: ["0_init", "1_a"], targetMigrations: ["0_init", "1_a"] }).verdict).toBe("SAFE");
  });
  it("requires review when newer (irreversible) migrations exist", () => {
    const r = assessRollback({ currentMigrations: ["0_init", "1_a", "2_b"], targetMigrations: ["0_init", "1_a"] });
    expect(r.verdict).toBe("REQUIRES_REVIEW");
    expect(r.newerMigrations).toEqual(["2_b"]);
  });
  it("is UNKNOWN when history is missing — never guessed as safe", () => {
    expect(assessRollback({ currentMigrations: null, targetMigrations: ["0_init"] }).verdict).toBe("UNKNOWN");
  });
});

describe("control update validation", () => {
  it("accepts valid thresholds and rejects out-of-range / unknown keys", () => {
    expect(parseControlUpdate("thresholds", { slowQueryThresholdMs: 800 }).ok).toBe(true);
    expect(parseControlUpdate("thresholds", { slowQueryThresholdMs: 1 }).ok).toBe(false);
    expect(parseControlUpdate("thresholds", { evil: 1 }).ok).toBe(false);
    expect(parseControlUpdate("nope", {}).ok).toBe(false);
    expect(parseControlUpdate("thresholds", {}).ok).toBe(false);
  });
  it("requires reauth for state, emergency, session and turning maintenance on", () => {
    expect(sectionRequiresReauth("state", {})).toBe(true);
    expect(sectionRequiresReauth("emergency", {})).toBe(true);
    expect(sectionRequiresReauth("session", {})).toBe(true);
    expect(sectionRequiresReauth("maintenance", { maintenanceMode: "ON" })).toBe(true);
    expect(sectionRequiresReauth("maintenance", { maintenanceMode: "OFF" })).toBe(false);
    expect(sectionRequiresReauth("thresholds", {})).toBe(false);
  });
  it("maps every section to a permission", () => {
    expect(SECTION_PERMISSION.emergency).toBe("system:emergency:manage");
    expect(SECTION_PERMISSION.backup).toBe("system:config:manage");
  });
});

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const pdf = Buffer.from("%PDF-1.7 test");
const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

describe("upload validation", () => {
  it("detects real types from magic bytes", () => {
    expect(detectFileType(jpeg)).toBe("image/jpeg");
    expect(detectFileType(png)).toBe("image/png");
    expect(detectFileType(pdf)).toBe("application/pdf");
    expect(detectFileType(Buffer.from("MZ executable"))).toBeNull();
  });
  it("accepts a matching declaration", () => {
    expect(validateUpload({ buffer: jpeg, declaredMime: "image/jpeg", filename: "photo.jpg", allowed, maxBytes: 1000 }).ok).toBe(true);
  });
  it("rejects a spoofed MIME type", () => {
    expect(validateUpload({ buffer: Buffer.from("MZ..."), declaredMime: "image/jpeg", allowed, maxBytes: 1000 }).ok).toBe(false);
    expect(validateUpload({ buffer: pdf, declaredMime: "image/png", allowed, maxBytes: 1000 }).ok).toBe(false);
  });
  it("rejects oversize and empty files", () => {
    expect(validateUpload({ buffer: jpeg, declaredMime: "image/jpeg", allowed, maxBytes: 5 }).ok).toBe(false);
    expect(validateUpload({ buffer: Buffer.alloc(0), declaredMime: "image/jpeg", allowed, maxBytes: 5 }).ok).toBe(false);
  });
  it("rejects dangerous, traversal and mismatched filenames", () => {
    for (const name of ["a.php.jpg", "evil.exe", "../../etc/passwd.jpg", "x.jpg\0.png", "photo.png"]) {
      expect(validateUpload({ buffer: jpeg, declaredMime: "image/jpeg", filename: name, allowed, maxBytes: 1000 }).ok).toBe(false);
    }
  });
  it("sanitises stored filenames and builds a header-safe Content-Disposition", () => {
    expect(safeFilename("../../a\"b;c.jpg")).toBe("abc.jpg");
    expect(safeFilename(null)).toBe("file");
    const header = contentDisposition('x".pdf\r\nSet-Cookie: a=b');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain('x".');
  });
});

describe("feature flag registry", () => {
  it("only registers flags with a real consumer and defaults them to enabled", () => {
    expect(Object.keys(FEATURE_FLAG_DEFAULTS)).toContain("matching.enabled");
    expect(Object.keys(FEATURE_FLAG_DEFAULTS)).not.toContain("ai_matching.enabled");
    expect(Object.values(FEATURE_FLAG_DEFAULTS).every(Boolean)).toBe(true);
  });
  it("treats payments.enabled as externally managed (not editable here)", () => {
    expect(isKnownFeatureFlag("payments.enabled")).toBe(false);
    expect(isKnownFeatureFlag("matching.enabled")).toBe(true);
    expect(isKnownFeatureFlag("made.up")).toBe(false);
  });
});

describe("matching eligibility (manual pairing)", () => {
  const ok = { id: "a", gender: "MALE", softDeleted: false, status: "ACTIVE", accountStatus: "ACTIVE" } as const;
  const other = { id: "b", gender: "FEMALE", softDeleted: false, status: "ACTIVE", accountStatus: "ACTIVE" } as const;
  it("allows an active opposite-gender pair", () => {
    expect(pairEligibilityProblem(ok, other)).toBeNull();
  });
  it("rejects self, same gender, deleted, suspended, married and deactivated profiles", () => {
    expect(pairEligibilityProblem(ok, ok)).toMatch(/itself/);
    expect(pairEligibilityProblem(ok, { ...other, gender: "MALE" })).toMatch(/opposite/);
    expect(pairEligibilityProblem(ok, { ...other, softDeleted: true })).toMatch(/deleted/);
    expect(pairEligibilityProblem(ok, { ...other, status: "SUSPENDED" })).toMatch(/suspended/);
    expect(pairEligibilityProblem(ok, { ...other, status: "MARRIED" })).toMatch(/married/);
    expect(pairEligibilityProblem({ ...ok }, { ...other, accountStatus: "DEACTIVATED" })).toMatch(/active account/);
    expect(profileExclusionReason(ok)).toBeNull();
  });
});
