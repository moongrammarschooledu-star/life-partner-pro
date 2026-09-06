import type { AdminRole } from "@/lib/permissions";

export type DataSource = "Profiles" | "Verification" | "Matches" | "Proposals" | "Meetings" | "Communications" | "FollowUps";

export interface ColumnDef {
  key: string;
  label: string;
  sensitive: boolean; // mobile/WhatsApp/email/income/family/private-notes (spec §23)
}

export interface ReportDefinition {
  columns: ColumnDef[];
  filterableFields: string[]; // subset of the 11-filter vocabulary applicable to this source
  groupByFields: string[]; // spec §22
  sortByFields: string[]; // spec §22
}

// Whitelisted, not a free-form query builder — every field a Custom Report
// (or export) can ever touch is enumerated here. Nothing outside this
// registry is ever selectable, so there is no raw-SQL/arbitrary-field
// injection surface (spec §22).
export const REPORT_DEFINITIONS: Record<DataSource, ReportDefinition> = {
  Profiles: {
    columns: [
      { key: "profileCode", label: "Profile ID", sensitive: false },
      { key: "fullName", label: "Full Name", sensitive: false },
      { key: "gender", label: "Gender", sensitive: false },
      { key: "age", label: "Age", sensitive: false },
      { key: "city", label: "City", sensitive: false },
      { key: "area", label: "Area", sensitive: false },
      { key: "maritalStatus", label: "Marital Status", sensitive: false },
      { key: "status", label: "Profile Status", sensitive: false },
      { key: "verified", label: "Verified", sensitive: false },
      { key: "profileCompletion", label: "Completeness %", sensitive: false },
      { key: "createdAt", label: "Registered", sensitive: false },
      { key: "mobileNumber", label: "Mobile Number", sensitive: true },
      { key: "whatsappNumber", label: "WhatsApp Number", sensitive: true },
      { key: "email", label: "Email", sensitive: true },
      { key: "monthlyIncome", label: "Monthly Income", sensitive: true },
      { key: "familyBackground", label: "Family Background", sensitive: true },
    ],
    filterableFields: ["city", "area", "gender", "minAge", "maxAge", "profession", "education", "maritalStatus", "profileStatus"],
    groupByFields: ["city", "gender", "profileStatus", "maritalStatus"],
    sortByFields: ["createdAt", "profileCompletion"],
  },
  Verification: {
    columns: [
      { key: "profileCode", label: "Profile ID", sensitive: false },
      { key: "status", label: "Verification Status", sensitive: false },
      { key: "phoneVerifiedAt", label: "Phone Verified", sensitive: false },
      { key: "emailVerifiedAt", label: "Email Verified", sensitive: false },
      { key: "assignedTo", label: "Assigned Staff", sensitive: false },
      { key: "lastReviewedAt", label: "Last Reviewed", sensitive: false },
      { key: "createdAt", label: "Submitted", sensitive: false },
    ],
    filterableFields: ["verificationStatus", "staffId", "city", "gender"],
    groupByFields: ["status"],
    sortByFields: ["createdAt", "lastReviewedAt"],
  },
  Matches: {
    columns: [
      { key: "profileACode", label: "Profile A", sensitive: false },
      { key: "profileBCode", label: "Profile B", sensitive: false },
      { key: "score", label: "Compatibility Score", sensitive: false },
      { key: "status", label: "Match Status", sensitive: false },
      { key: "recommendation", label: "Recommendation", sensitive: false },
      { key: "createdAt", label: "Generated", sensitive: false },
    ],
    filterableFields: ["city", "gender"],
    groupByFields: ["status", "recommendation"],
    sortByFields: ["createdAt", "score"],
  },
  Proposals: {
    columns: [
      { key: "proposalCode", label: "Proposal ID", sensitive: false },
      { key: "profileACode", label: "Profile A", sensitive: false },
      { key: "profileBCode", label: "Profile B", sensitive: false },
      { key: "status", label: "Status", sensitive: false },
      { key: "priority", label: "Priority", sensitive: false },
      { key: "matchScore", label: "Match Score", sensitive: false },
      { key: "createdAt", label: "Created", sensitive: false },
      { key: "finalizedAt", label: "Finalized", sensitive: false },
      { key: "marriedAt", label: "Married", sensitive: false },
      { key: "internalRejectionNote", label: "Internal Rejection Note", sensitive: true },
    ],
    filterableFields: ["proposalStatus", "staffId", "city"],
    groupByFields: ["status"],
    sortByFields: ["createdAt", "matchScore", "status"],
  },
  Meetings: {
    columns: [
      { key: "proposalCode", label: "Proposal ID", sensitive: false },
      { key: "meetingType", label: "Meeting Type", sensitive: false },
      { key: "scheduledAt", label: "Scheduled At", sensitive: false },
      { key: "status", label: "Status", sensitive: false },
      { key: "locationInfo", label: "Location", sensitive: true },
      { key: "notes", label: "Notes", sensitive: true },
    ],
    filterableFields: ["staffId", "proposalStatus"],
    groupByFields: ["status", "meetingType"],
    sortByFields: ["scheduledAt", "status"],
  },
  Communications: {
    columns: [
      { key: "profileCode", label: "Profile ID", sensitive: false },
      { key: "channel", label: "Channel", sensitive: false },
      { key: "notificationType", label: "Type", sensitive: false },
      { key: "deliveryStatus", label: "Delivery Status", sensitive: false },
      { key: "createdAt", label: "Date", sensitive: false },
      { key: "messageBody", label: "Message Content", sensitive: true },
    ],
    filterableFields: ["city"],
    groupByFields: ["channel", "deliveryStatus"],
    sortByFields: ["createdAt"],
  },
  FollowUps: {
    columns: [
      { key: "profileCode", label: "Profile ID", sensitive: false },
      { key: "title", label: "Title", sensitive: false },
      { key: "purpose", label: "Purpose", sensitive: false },
      { key: "dueDate", label: "Due Date", sensitive: false },
      { key: "status", label: "Status", sensitive: false },
      { key: "priority", label: "Priority", sensitive: false },
      { key: "outcome", label: "Outcome", sensitive: false },
      { key: "note", label: "Private Note", sensitive: true },
    ],
    filterableFields: ["staffId", "city"],
    groupByFields: ["status", "priority"],
    sortByFields: ["dueDate", "status"],
  },
};

// Only SUPER_ADMIN/ADMIN ever see sensitive columns (mobile/WhatsApp/email/
// income/family/private-notes) — STAFF and VIEWER never do, in either the
// on-screen Custom Report table or any exported file (spec §23).
export function canViewSensitiveColumns(role: AdminRole): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

// The single point of truth for redaction — called identically by the
// Custom Report Builder and every export route so a STAFF admin can never
// see a sensitive field regardless of format.
export function getReportColumns(dataSource: DataSource, role: AdminRole): ColumnDef[] {
  const allColumns = REPORT_DEFINITIONS[dataSource].columns;
  if (canViewSensitiveColumns(role)) return allColumns;
  return allColumns.filter((c) => !c.sensitive);
}
