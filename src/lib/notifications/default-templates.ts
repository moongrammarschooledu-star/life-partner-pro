import type { NotificationType } from "@prisma/client";

// Flat EN/UR dictionary, same shape as src/lib/i18n/registration-strings.ts.
// This is the built-in fallback used whenever no ACTIVE NotificationTemplate
// override exists for a given (event, language) — see template-resolver.ts.
// Copy is deliberately channel-agnostic (short, generic, privacy-safe per
// spec §33); `subject` is used only when rendering for the EMAIL channel.
// Admins can still create a channel-specific NotificationTemplate override
// if they want different wording per channel.

export interface DefaultCopy {
  title: string;
  body: string;
  subject?: string;
}

type Dict = Record<NotificationType, Record<"EN" | "UR", DefaultCopy>>;

export const DEFAULT_TEMPLATES: Dict = {
  ACCOUNT_REGISTERED: {
    EN: { title: "Welcome to Life Partner Pro", subject: "Welcome to Life Partner Pro", body: "Thank you for registering with Life Partner Pro. Our team will guide you through the next steps." },
    UR: { title: "لائف پارٹنر پرو میں خوش آمدید", subject: "لائف پارٹنر پرو میں خوش آمدید", body: "لائف پارٹنر پرو میں رجسٹریشن کا شکریہ۔ ہماری ٹیم اگلے مراحل میں آپ کی رہنمائی کرے گی۔" },
  },
  MOBILE_VERIFIED: {
    EN: { title: "Mobile Verified", body: "Your mobile number has been successfully verified." },
    UR: { title: "موبائل نمبر تصدیق شدہ", body: "آپ کا موبائل نمبر کامیابی سے تصدیق ہو گیا ہے۔" },
  },
  EMAIL_VERIFIED: {
    EN: { title: "Email Verified", body: "Your email address has been successfully verified." },
    UR: { title: "ای میل تصدیق شدہ", body: "آپ کا ای میل ایڈریس کامیابی سے تصدیق ہو گیا ہے۔" },
  },
  PROFILE_SUBMITTED: {
    EN: { title: "Profile Submitted", subject: "Your Profile Has Been Submitted", body: "Your profile has been submitted for review. Our team will contact you when appropriate." },
    UR: { title: "پروفائل جمع ہو گئی", subject: "آپ کی پروفائل جمع ہو گئی ہے", body: "آپ کی پروفائل جائزے کے لیے جمع ہو گئی ہے۔ مناسب وقت پر ہماری ٹیم آپ سے رابطہ کرے گی۔" },
  },
  PROFILE_APPROVED: {
    EN: { title: "Profile Approved", body: "Your profile has been approved and is now active." },
    UR: { title: "پروفائل منظور", body: "آپ کی پروفائل منظور ہو گئی ہے اور اب فعال ہے۔" },
  },
  PROFILE_UPDATE_APPROVED: {
    EN: { title: "Profile Update Approved", body: "Your requested profile update has been approved." },
    UR: { title: "پروفائل اپڈیٹ منظور", body: "آپ کی درخواست کردہ پروفائل اپڈیٹ منظور ہو گئی ہے۔" },
  },
  PROFILE_UPDATE_REJECTED: {
    EN: { title: "Profile Update Not Approved", body: "Your requested profile update was not approved. Please login for more information." },
    UR: { title: "پروفائل اپڈیٹ منظور نہیں ہوئی", body: "آپ کی درخواست کردہ پروفائل اپڈیٹ منظور نہیں ہوئی۔ مزید معلومات کے لیے لاگ ان کریں۔" },
  },
  ACCOUNT_SUSPENDED: {
    EN: { title: "Account Suspended", body: "Your Life Partner Pro profile has been suspended. Please contact support for more information." },
    UR: { title: "اکاؤنٹ معطل", body: "آپ کی لائف پارٹنر پرو پروفائل معطل کر دی گئی ہے۔ مزید معلومات کے لیے سپورٹ سے رابطہ کریں۔" },
  },
  VERIFICATION_STARTED: {
    EN: { title: "Verification Started", body: "Your profile verification review has started." },
    UR: { title: "تصدیق کا عمل شروع", body: "آپ کی پروفائل کی تصدیق کا جائزہ شروع ہو گیا ہے۔" },
  },
  VERIFICATION_APPROVED: {
    EN: { title: "Profile Verified", subject: "Your Life Partner Pro Profile Has Been Verified", body: "Your profile has been verified. You now have a Verified badge." },
    UR: { title: "پروفائل تصدیق شدہ", subject: "آپ کی لائف پارٹنر پرو پروفائل تصدیق ہو گئی ہے", body: "آپ کی پروفائل تصدیق ہو گئی ہے۔ اب آپ کے پاس تصدیق شدہ بیج ہے۔" },
  },
  VERIFICATION_ACTION_REQUIRED: {
    EN: { title: "Action Required", body: "Action is required on your Life Partner Pro profile. Please login to My Verification to review what's needed." },
    UR: { title: "کارروائی درکار ہے", body: "آپ کی لائف پارٹنر پرو پروفائل پر کارروائی درکار ہے۔ تفصیلات کے لیے My Verification میں لاگ ان کریں۔" },
  },
  VERIFICATION_REJECTED: {
    EN: { title: "Verification Update", body: "There is an update on your Life Partner Pro verification. Please login to My Verification for details." },
    UR: { title: "تصدیق میں تازہ کاری", body: "آپ کی لائف پارٹنر پرو تصدیق میں تازہ کاری ہے۔ تفصیلات کے لیے My Verification میں لاگ ان کریں۔" },
  },
  RE_VERIFICATION_REQUIRED: {
    EN: { title: "Re-Verification Required", body: "Your Life Partner Pro profile requires re-verification. Please login to My Verification to continue." },
    UR: { title: "دوبارہ تصدیق درکار", body: "آپ کی لائف پارٹنر پرو پروفائل کو دوبارہ تصدیق کی ضرورت ہے۔ جاری رکھنے کے لیے My Verification میں لاگ ان کریں۔" },
  },
  MATCH_IDENTIFIED: {
    EN: { title: "New Match Identified", body: "A potential matrimonial match has been identified for you." },
    UR: { title: "نیا میچ ملا", body: "آپ کے لیے ایک ممکنہ رشتہ میچ شناخت ہوا ہے۔" },
  },
  PROPOSAL_RECEIVED: {
    EN: { title: "New Proposal", subject: "You Have a New Matrimonial Proposal", body: "You have received a new matrimonial proposal. Please login to review it." },
    UR: { title: "نیا رشتہ", subject: "آپ کے لیے نیا رشتہ موجود ہے", body: "آپ کو ایک نیا رشتہ موصول ہوا ہے۔ جائزے کے لیے لاگ ان کریں۔" },
  },
  PROPOSAL_VIEWED: {
    EN: { title: "Proposal Viewed", body: "Your proposal has been viewed." },
    UR: { title: "رشتہ دیکھا گیا", body: "آپ کا رشتہ دیکھا گیا ہے۔" },
  },
  PROPOSAL_INTEREST_SUBMITTED: {
    EN: { title: "Interest Submitted", body: "Your interest has been submitted for a matrimonial proposal." },
    UR: { title: "دلچسپی جمع ہو گئی", body: "آپ کی دلچسپی ایک رشتے کے لیے جمع ہو گئی ہے۔" },
  },
  PROPOSAL_NOT_INTERESTED: {
    EN: { title: "Proposal Update", body: "There is an update on one of your matrimonial proposals. Please login to review it." },
    UR: { title: "رشتے میں تازہ کاری", body: "آپ کے ایک رشتے میں تازہ کاری ہے۔ جائزے کے لیے لاگ ان کریں۔" },
  },
  PROPOSAL_MUTUAL_INTEREST: {
    EN: { title: "Mutual Interest Received", subject: "Mutual Interest Received", body: "Both parties have expressed interest. Our admin team will guide the next step." },
    UR: { title: "باہمی دلچسپی موصول", subject: "باہمی دلچسپی موصول ہوئی", body: "دونوں فریقین نے دلچسپی ظاہر کی ہے۔ ہماری ٹیم اگلے مرحلے میں رہنمائی کرے گی۔" },
  },
  PROPOSAL_ADMIN_ACTION_REQUIRED: {
    EN: { title: "Action Required", body: "Admin action is required on one of your matrimonial proposals." },
    UR: { title: "کارروائی درکار ہے", body: "آپ کے ایک رشتے پر انتظامی کارروائی درکار ہے۔" },
  },
  PROPOSAL_STATUS_CHANGED: {
    EN: { title: "Proposal Update", body: "There is an update on your matrimonial proposal. Please login to review it." },
    UR: { title: "رشتے میں تازہ کاری", body: "آپ کے رشتے میں تازہ کاری ہے۔ جائزے کے لیے لاگ ان کریں۔" },
  },
  PROPOSAL_PENDING_REMINDER: {
    EN: { title: "Proposal Awaiting Response", body: "You have a matrimonial proposal awaiting your response. Please login to review it." },
    UR: { title: "رشتہ جواب کا منتظر ہے", body: "آپ کا ایک رشتہ آپ کے جواب کا منتظر ہے۔ جائزے کے لیے لاگ ان کریں۔" },
  },
  PROPOSAL_FINALIZED: {
    EN: { title: "Proposal Finalized", body: "Your matrimonial proposal has been finalized." },
    UR: { title: "رشتہ حتمی ہو گیا", body: "آپ کا رشتہ حتمی مراحل میں پہنچ گیا ہے۔" },
  },
  CONTACT_PERMISSION_REQUESTED: {
    EN: { title: "Contact Permission Requested", body: "Contact permission has been requested for one of your matrimonial proposals." },
    UR: { title: "رابطے کی اجازت درخواست", body: "آپ کے ایک رشتے کے لیے رابطے کی اجازت مانگی گئی ہے۔" },
  },
  CONTACT_PERMISSION_APPROVED: {
    EN: { title: "Contact Permission Approved", body: "Contact permission has been approved for your matrimonial proposal." },
    UR: { title: "رابطے کی اجازت منظور", body: "آپ کے رشتے کے لیے رابطے کی اجازت منظور ہو گئی ہے۔" },
  },
  CONTACT_PERMISSION_REVOKED: {
    EN: { title: "Contact Permission Revoked", body: "Contact permission has been revoked for your matrimonial proposal." },
    UR: { title: "رابطے کی اجازت منسوخ", body: "آپ کے رشتے کے لیے رابطے کی اجازت منسوخ کر دی گئی ہے۔" },
  },
  MEETING_REQUESTED: {
    EN: { title: "Meeting Requested", body: "A matrimonial meeting has been requested. Please login to view the details." },
    UR: { title: "ملاقات کی درخواست", body: "ایک ملاقات کی درخواست کی گئی ہے۔ تفصیلات دیکھنے کے لیے لاگ ان کریں۔" },
  },
  MEETING_SCHEDULED: {
    EN: { title: "Meeting Scheduled", subject: "Your Matrimonial Meeting Has Been Scheduled", body: "Your matrimonial meeting has been scheduled. Login to view the details." },
    UR: { title: "ملاقات طے ہو گئی", subject: "آپ کی ملاقات طے ہو گئی ہے", body: "آپ کی ملاقات طے ہو گئی ہے۔ تفصیلات دیکھنے کے لیے لاگ ان کریں۔" },
  },
  MEETING_CONFIRMED: {
    EN: { title: "Meeting Confirmed", body: "Your matrimonial meeting has been confirmed." },
    UR: { title: "ملاقات کی تصدیق", body: "آپ کی ملاقات کی تصدیق ہو گئی ہے۔" },
  },
  MEETING_RESCHEDULED: {
    EN: { title: "Meeting Rescheduled", body: "Your matrimonial meeting has been rescheduled. Please login to view the new details." },
    UR: { title: "ملاقات دوبارہ طے", body: "آپ کی ملاقات دوبارہ طے کی گئی ہے۔ نئی تفصیلات دیکھنے کے لیے لاگ ان کریں۔" },
  },
  MEETING_CANCELLED: {
    EN: { title: "Meeting Cancelled", body: "Your matrimonial meeting has been cancelled." },
    UR: { title: "ملاقات منسوخ", body: "آپ کی ملاقات منسوخ کر دی گئی ہے۔" },
  },
  MEETING_COMPLETED: {
    EN: { title: "Meeting Completed", body: "Your matrimonial meeting has been marked as completed." },
    UR: { title: "ملاقات مکمل", body: "آپ کی ملاقات مکمل ہونے کے طور پر درج کر دی گئی ہے۔" },
  },
  MEETING_REMINDER_24H: {
    EN: { title: "Meeting Reminder", body: "This is a reminder about your scheduled matrimonial meeting." },
    UR: { title: "ملاقات کی یاد دہانی", body: "یہ آپ کی طے شدہ ملاقات کے بارے میں یاد دہانی ہے۔" },
  },
  MEETING_REMINDER_2H: {
    EN: { title: "Meeting Reminder", body: "This is a reminder about your scheduled matrimonial meeting." },
    UR: { title: "ملاقات کی یاد دہانی", body: "یہ آپ کی طے شدہ ملاقات کے بارے میں یاد دہانی ہے۔" },
  },
  FOLLOWUP_REMINDER: {
    EN: { title: "Follow-Up Reminder", subject: "Life Partner Pro Follow-Up Reminder", body: "This is a reminder regarding your matrimonial profile. Please login for details." },
    UR: { title: "فالو اپ یاد دہانی", subject: "لائف پارٹنر پرو فالو اپ یاد دہانی", body: "یہ آپ کی پروفائل کے بارے میں یاد دہانی ہے۔ تفصیلات کے لیے لاگ ان کریں۔" },
  },
  FOLLOWUP_ADMIN_RESPONSE_REQUESTED: {
    EN: { title: "Response Requested", body: "Our team has requested a response from you. Please login to reply." },
    UR: { title: "جواب درکار ہے", body: "ہماری ٹیم نے آپ سے جواب طلب کیا ہے۔ جواب دینے کے لیے لاگ ان کریں۔" },
  },
  ADMIN_MUTUAL_INTEREST: {
    EN: { title: "Mutual Interest — Action Required", body: "Both parties have expressed interest on a proposal. Review is required." },
    UR: { title: "باہمی دلچسپی — کارروائی درکار", body: "دونوں فریقین نے ایک رشتے میں دلچسپی ظاہر کی ہے۔ جائزہ درکار ہے۔" },
  },
  ADMIN_CONTACT_PERMISSION_REQUEST: {
    EN: { title: "Contact Permission Request", body: "A contact permission request needs review." },
    UR: { title: "رابطے کی اجازت کی درخواست", body: "رابطے کی اجازت کی ایک درخواست کو جائزے کی ضرورت ہے۔" },
  },
  ADMIN_MEETING_REQUEST: {
    EN: { title: "Meeting Request", body: "A new meeting request needs review." },
    UR: { title: "ملاقات کی درخواست", body: "ایک نئی ملاقات کی درخواست کو جائزے کی ضرورت ہے۔" },
  },
  ADMIN_MEETING_CONFIRMATION: {
    EN: { title: "Meeting Confirmation", body: "A meeting has been confirmed and may need follow-up." },
    UR: { title: "ملاقات کی تصدیق", body: "ایک ملاقات کی تصدیق ہو گئی ہے اور فالو اپ درکار ہو سکتا ہے۔" },
  },
  ADMIN_OVERDUE_FOLLOWUP: {
    EN: { title: "Overdue Follow-up", body: "A follow-up is overdue and needs attention." },
    UR: { title: "زائد المیعاد فالو اپ", body: "ایک فالو اپ کی میعاد ختم ہو چکی ہے اور توجہ درکار ہے۔" },
  },
  ADMIN_SUSPICIOUS_ACTIVITY: {
    EN: { title: "Suspicious Activity", body: "Suspicious account activity has been flagged for review." },
    UR: { title: "مشکوک سرگرمی", body: "مشکوک اکاؤنٹ سرگرمی کو جائزے کے لیے نشان زد کیا گیا ہے۔" },
  },
  ADMIN_DUPLICATE_PROFILE_ALERT: {
    EN: { title: "Duplicate Profile Alert", body: "A potential duplicate profile has been flagged for review." },
    UR: { title: "نقل پروفائل الرٹ", body: "ایک ممکنہ نقل پروفائل کو جائزے کے لیے نشان زد کیا گیا ہے۔" },
  },
  ADMIN_PROFILE_UPDATE_PENDING: {
    EN: { title: "Profile Update Pending", body: "A profile update request is awaiting your approval." },
    UR: { title: "پروفائل اپڈیٹ زیر التوا", body: "ایک پروفائل اپڈیٹ کی درخواست آپ کی منظوری کی منتظر ہے۔" },
  },
  ADMIN_ASSIGNMENT_CHANGED: {
    EN: { title: "Assignment Changed", body: "A record has been assigned to you." },
    UR: { title: "تفویض تبدیل ہوئی", body: "ایک ریکارڈ آپ کو تفویض کیا گیا ہے۔" },
  },
  ADMIN_DIRECT_MESSAGE: {
    EN: { title: "New Message", subject: "You Have a New Message", body: "You have a new message from our team. Please login to view it." },
    UR: { title: "نیا پیغام", subject: "آپ کے لیے نیا پیغام", body: "ہماری ٹیم کی طرف سے آپ کے لیے ایک نیا پیغام ہے۔ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  TEST_NOTIFICATION: {
    EN: { title: "Test Notification", body: "This is a test notification from Life Partner Pro." },
    UR: { title: "ٹیسٹ نوٹیفیکیشن", body: "یہ لائف پارٹنر پرو کی طرف سے ایک ٹیسٹ نوٹیفیکیشن ہے۔" },
  },

  // ---------- Support, Complaints, Safety & Case Management (STEP 12) ----------
  // Deliberately generic (spec §22 — never include case description,
  // evidence, or internal-note content in a notification preview).
  CASE_CREATED: {
    EN: { title: "Case Received", subject: "We've Received Your Request", body: "Your request has been received and will be reviewed by our team. You can track its status anytime." },
    UR: { title: "کیس موصول ہو گیا", subject: "آپ کی درخواست موصول ہو گئی", body: "آپ کی درخواست موصول ہو گئی ہے اور ہماری ٹیم اس کا جائزہ لے گی۔ آپ کسی بھی وقت اس کی صورتحال دیکھ سکتے ہیں۔" },
  },
  CASE_ASSIGNED: {
    EN: { title: "Case Assigned", body: "A case has been assigned to you." },
    UR: { title: "کیس تفویض ہوا", body: "ایک کیس آپ کو تفویض کیا گیا ہے۔" },
  },
  CASE_REASSIGNED: {
    EN: { title: "Case Reassigned", body: "A case has been reassigned." },
    UR: { title: "کیس دوبارہ تفویض ہوا", body: "ایک کیس دوبارہ تفویض کیا گیا ہے۔" },
  },
  CASE_UPDATED: {
    EN: { title: "Case Update", subject: "Update on Your Request", body: "There is an update on your request. Please login to view the details." },
    UR: { title: "کیس اپڈیٹ", subject: "آپ کی درخواست پر اپڈیٹ", body: "آپ کی درخواست پر ایک اپڈیٹ موجود ہے۔ تفصیلات دیکھنے کے لیے لاگ ان کریں۔" },
  },
  CASE_COMMENT_ADDED: {
    EN: { title: "New Response", subject: "New Response on Your Request", body: "Our team has responded to your request. Please login to view the message." },
    UR: { title: "نیا جواب", subject: "آپ کی درخواست پر نیا جواب", body: "ہماری ٹیم نے آپ کی درخواست کا جواب دیا ہے۔ پیغام دیکھنے کے لیے لاگ ان کریں۔" },
  },
  INFORMATION_REQUESTED: {
    EN: { title: "More Information Needed", subject: "We Need More Information", body: "Our team needs more information to proceed with your request. Please login to respond." },
    UR: { title: "مزید معلومات درکار", subject: "ہمیں مزید معلومات درکار ہیں", body: "آپ کی درخواست پر آگے بڑھنے کے لیے ہماری ٹیم کو مزید معلومات درکار ہیں۔ جواب دینے کے لیے لاگ ان کریں۔" },
  },
  USER_RESPONDED: {
    EN: { title: "User Responded", body: "The reporting user has submitted the requested information." },
    UR: { title: "صارف نے جواب دیا", body: "رپورٹ کرنے والے صارف نے مطلوبہ معلومات جمع کر دی ہیں۔" },
  },
  CASE_ESCALATED: {
    EN: { title: "Case Escalated", body: "A case has been escalated and requires senior review." },
    UR: { title: "کیس اپگریڈ ہوا", body: "ایک کیس اپگریڈ کیا گیا ہے اور اسے سینئر جائزے کی ضرورت ہے۔" },
  },
  CASE_OVERDUE: {
    EN: { title: "Case Overdue", body: "A case has passed its SLA deadline and needs attention." },
    UR: { title: "کیس کی مدت ختم", body: "ایک کیس کی مقررہ مدت ختم ہو چکی ہے اور اسے توجہ درکار ہے۔" },
  },
  CASE_RESOLVED: {
    EN: { title: "Request Resolved", subject: "Your Request Has Been Resolved", body: "Your request has been resolved. Please login to view the resolution details." },
    UR: { title: "درخواست حل ہو گئی", subject: "آپ کی درخواست حل ہو گئی ہے", body: "آپ کی درخواست حل ہو گئی ہے۔ تفصیلات دیکھنے کے لیے لاگ ان کریں۔" },
  },
  CASE_CLOSED: {
    EN: { title: "Case Closed", subject: "Your Case Has Been Closed", body: "Your case has been closed. Please login if you'd like to review the outcome." },
    UR: { title: "کیس بند ہو گیا", subject: "آپ کا کیس بند ہو گیا ہے", body: "آپ کا کیس بند ہو گیا ہے۔ نتیجہ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  CASE_REOPENED: {
    EN: { title: "Case Reopened", subject: "Your Case Has Been Reopened", body: "Your case has been reopened and is being reviewed again." },
    UR: { title: "کیس دوبارہ کھل گیا", subject: "آپ کا کیس دوبارہ کھل گیا ہے", body: "آپ کا کیس دوبارہ کھل گیا ہے اور اس کا دوبارہ جائزہ لیا جا رہا ہے۔" },
  },
  ADMIN_PROFILE_RESTRICTED: {
    EN: { title: "Profile Restriction Applied", body: "A restriction has been applied to a profile." },
    UR: { title: "پروفائل پر پابندی لاگو", body: "ایک پروفائل پر پابندی لاگو کی گئی ہے۔" },
  },

  // ---------- Data Privacy, Consent, Account Management & Retention (STEP 13) ----------
  // Deliberately generic — spec §34/§35 — never any account, deletion-mode,
  // or export-content detail in an externally-sent preview.
  ACCOUNT_DEACTIVATED: {
    EN: { title: "Account Deactivated", subject: "Your Account Has Been Deactivated", body: "Your Life Partner Pro account has been deactivated. Please log in to review your account." },
    UR: { title: "اکاؤنٹ غیر فعال", subject: "آپ کا اکاؤنٹ غیر فعال کر دیا گیا ہے", body: "آپ کا لائف پارٹنر پرو اکاؤنٹ غیر فعال کر دیا گیا ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  ACCOUNT_REACTIVATED: {
    EN: { title: "Account Reactivated", subject: "Your Account Has Been Reactivated", body: "Your Life Partner Pro account has been reactivated. Please log in to review your account." },
    UR: { title: "اکاؤنٹ دوبارہ فعال", subject: "آپ کا اکاؤنٹ دوبارہ فعال کر دیا گیا ہے", body: "آپ کا لائف پارٹنر پرو اکاؤنٹ دوبارہ فعال کر دیا گیا ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  DELETION_REQUEST_RECEIVED: {
    EN: { title: "Deletion Request Received", subject: "We Received Your Deletion Request", body: "Your Life Partner Pro account has a new update. Please log in to review your account." },
    UR: { title: "حذف کی درخواست موصول", subject: "آپ کی حذف کی درخواست موصول ہو گئی", body: "آپ کے لائف پارٹنر پرو اکاؤنٹ میں ایک نئی اپ ڈیٹ ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  DELETION_COMPLETED: {
    EN: { title: "Deletion Request Completed", subject: "Your Deletion Request Has Been Completed", body: "Your account deletion request has been completed." },
    UR: { title: "حذف کی درخواست مکمل", subject: "آپ کی حذف کی درخواست مکمل ہو گئی", body: "آپ کے اکاؤنٹ کو حذف کرنے کی درخواست مکمل ہو گئی ہے۔" },
  },
  DATA_EXPORT_READY: {
    EN: { title: "Your Data Export Is Ready", subject: "Your Data Export Is Ready", body: "Your requested data export is ready to download. Please log in to review your account." },
    UR: { title: "آپ کا ڈیٹا ایکسپورٹ تیار ہے", subject: "آپ کا ڈیٹا ایکسپورٹ تیار ہے", body: "آپ کا درخواست کردہ ڈیٹا ایکسپورٹ ڈاؤن لوڈ کے لیے تیار ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  PRIVACY_REQUEST_UPDATED: {
    EN: { title: "Privacy Request Updated", subject: "Your Privacy Request Has Been Updated", body: "Your Life Partner Pro account has a new update. Please log in to review your account." },
    UR: { title: "پرائیویسی درخواست میں تبدیلی", subject: "آپ کی پرائیویسی درخواست میں تبدیلی ہوئی ہے", body: "آپ کے لائف پارٹنر پرو اکاؤنٹ میں ایک نئی اپ ڈیٹ ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },

  // ---------- Payment, Subscription, Packages & Financial Management (STEP 14) ----------
  // Deliberately generic — spec §49 — amounts/methods/reasons are never
  // interpolated into an externally-sent preview.
  PAYMENT_SUCCESS: {
    EN: { title: "Payment Successful", subject: "Your Payment Was Successful", body: "Your payment has been received. Please log in to review your account." },
    UR: { title: "ادائیگی کامیاب", subject: "آپ کی ادائیگی کامیاب رہی", body: "آپ کی ادائیگی موصول ہو گئی ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  PAYMENT_FAILED: {
    EN: { title: "Payment Unsuccessful", subject: "There Was an Issue With Your Payment", body: "We were unable to process your recent payment. Please log in to review your account." },
    UR: { title: "ادائیگی ناکام", subject: "آپ کی ادائیگی میں مسئلہ ہوا", body: "ہم آپ کی حالیہ ادائیگی پر کارروائی نہیں کر سکے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  REFUND_REQUESTED: {
    EN: { title: "Refund Requested", subject: "Your Refund Request Has Been Received", body: "A refund request has been recorded for your account. Please log in to review your account." },
    UR: { title: "رقم کی واپسی کی درخواست", subject: "آپ کی رقم کی واپسی کی درخواست موصول ہوگئی", body: "آپ کے اکاؤنٹ کے لیے رقم کی واپسی کی درخواست درج کر لی گئی ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  REFUND_COMPLETED: {
    EN: { title: "Refund Completed", subject: "Your Refund Has Been Completed", body: "Your refund has been processed. Please log in to review your account." },
    UR: { title: "رقم کی واپسی مکمل", subject: "آپ کی رقم کی واپسی مکمل ہو گئی", body: "آپ کی رقم کی واپسی کر دی گئی ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  SUBSCRIPTION_STARTED: {
    EN: { title: "Subscription Started", subject: "Your Subscription Is Now Active", body: "Your subscription has started. Please log in to review your account." },
    UR: { title: "سبسکرپشن شروع", subject: "آپ کی سبسکرپشن اب فعال ہے", body: "آپ کی سبسکرپشن شروع ہو گئی ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  SUBSCRIPTION_RENEWED: {
    EN: { title: "Subscription Renewed", subject: "Your Subscription Has Been Renewed", body: "Your subscription has been renewed. Please log in to review your account." },
    UR: { title: "سبسکرپشن تجدید", subject: "آپ کی سبسکرپشن کی تجدید ہو گئی", body: "آپ کی سبسکرپشن کی تجدید ہو گئی ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  SUBSCRIPTION_EXPIRING: {
    EN: { title: "Subscription Needs Renewal", subject: "Your Subscription Needs Renewal", body: "Your subscription requires renewal. Please log in to review your account." },
    UR: { title: "سبسکرپشن کی تجدید درکار ہے", subject: "آپ کی سبسکرپشن کی تجدید درکار ہے", body: "آپ کی سبسکرپشن کی تجدید درکار ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  SUBSCRIPTION_CANCELLED: {
    EN: { title: "Subscription Cancelled", subject: "Your Subscription Has Been Cancelled", body: "Your subscription has been cancelled. Please log in to review your account." },
    UR: { title: "سبسکرپشن منسوخ", subject: "آپ کی سبسکرپشن منسوخ ہو گئی", body: "آپ کی سبسکرپشن منسوخ ہو گئی ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  INVOICE_CREATED: {
    EN: { title: "New Invoice", subject: "A New Invoice Is Available", body: "A new invoice is available on your account. Please log in to review your account." },
    UR: { title: "نیا انوائس", subject: "ایک نیا انوائس دستیاب ہے", body: "آپ کے اکاؤنٹ پر ایک نیا انوائس دستیاب ہے۔ براہ کرم اپنا اکاؤنٹ دیکھنے کے لیے لاگ ان کریں۔" },
  },
  MANUAL_PAYMENT_REQUIRES_REVIEW: {
    EN: { title: "Payment Under Review", body: "A manual payment submission is awaiting admin review." },
    UR: { title: "ادائیگی زیر جائزہ", body: "ایک دستی ادائیگی کی جمع کرائی گئی درخواست انتظامی جائزے کی منتظر ہے۔" },
  },

  // ---------- Workflow & Task Management (STEP 18) ----------
  TASK_ASSIGNED: {
    EN: { title: "Task Assigned", body: "A task has been assigned to you." },
    UR: { title: "ٹاسک تفویض ہوا", body: "ایک ٹاسک آپ کو تفویض کیا گیا ہے۔" },
  },
  TASK_REASSIGNED: {
    EN: { title: "Task Reassigned", body: "A task has been reassigned." },
    UR: { title: "ٹاسک دوبارہ تفویض ہوا", body: "ایک ٹاسک دوبارہ تفویض کیا گیا ہے۔" },
  },
  TASK_DUE_SOON: {
    EN: { title: "Task Due Soon", body: "A task assigned to you is due soon." },
    UR: { title: "ٹاسک جلد واجب الادا ہے", body: "آپ کو تفویض کردہ ایک ٹاسک جلد واجب الادا ہے۔" },
  },
  TASK_OVERDUE: {
    EN: { title: "Task Overdue", body: "A task assigned to you is overdue." },
    UR: { title: "ٹاسک زائد المیعاد ہے", body: "آپ کو تفویض کردہ ایک ٹاسک کی میعاد ختم ہو چکی ہے۔" },
  },
  TASK_ESCALATED: {
    EN: { title: "Task Escalated", body: "A task has been escalated and needs higher-level review." },
    UR: { title: "ٹاسک بڑھایا گیا", body: "ایک ٹاسک کو بڑھایا گیا ہے اور اعلیٰ سطحی جائزے کی ضرورت ہے۔" },
  },
  TASK_COMMENT_MENTION: {
    EN: { title: "Mentioned in a Task", body: "You were mentioned in a task comment." },
    UR: { title: "ٹاسک میں ذکر", body: "ایک ٹاسک کے تبصرے میں آپ کا ذکر کیا گیا ہے۔" },
  },
  TASK_DEPENDENCY_COMPLETED: {
    EN: { title: "Dependency Completed", body: "A task your work depends on has been completed." },
    UR: { title: "انحصار مکمل ہوا", body: "ایک ٹاسک جس پر آپ کا کام منحصر تھا مکمل ہو گیا ہے۔" },
  },
  TASK_REOPENED: {
    EN: { title: "Task Reopened", body: "A completed task has been reopened." },
    UR: { title: "ٹاسک دوبارہ کھولا گیا", body: "ایک مکمل شدہ ٹاسک دوبارہ کھولا گیا ہے۔" },
  },

  // ---------- Approval Governance (STEP 19) ----------
  APPROVAL_REQUESTED: {
    EN: { title: "Approval Requested", body: "A high-risk action needs your approval." },
    UR: { title: "منظوری درکار ہے", body: "ایک حساس اقدام کو آپ کی منظوری درکار ہے۔" },
  },
  APPROVAL_ASSIGNED: {
    EN: { title: "Approval Assigned", body: "An approval request has been assigned to you." },
    UR: { title: "منظوری تفویض کی گئی", body: "ایک منظوری کی درخواست آپ کو تفویض کی گئی ہے۔" },
  },
  APPROVAL_APPROVED: {
    EN: { title: "Approval Granted", body: "Your approval request has been approved." },
    UR: { title: "منظوری دے دی گئی", body: "آپ کی منظوری کی درخواست منظور ہو گئی ہے۔" },
  },
  APPROVAL_REJECTED: {
    EN: { title: "Approval Rejected", body: "Your approval request has been rejected." },
    UR: { title: "منظوری مسترد", body: "آپ کی منظوری کی درخواست مسترد کر دی گئی ہے۔" },
  },
  APPROVAL_CHANGES_REQUESTED: {
    EN: { title: "Changes Requested", body: "Changes have been requested on your approval request." },
    UR: { title: "تبدیلی کی درخواست", body: "آپ کی منظوری کی درخواست میں تبدیلی مانگی گئی ہے۔" },
  },
  APPROVAL_EXPIRING: {
    EN: { title: "Approval Expiring Soon", body: "A pending approval request is about to expire." },
    UR: { title: "منظوری کی میعاد ختم ہونے والی ہے", body: "ایک زیر التواء منظوری کی میعاد جلد ختم ہو جائے گی۔" },
  },
  APPROVAL_EXPIRED: {
    EN: { title: "Approval Expired", body: "Your approval request has expired without a decision." },
    UR: { title: "منظوری کی میعاد ختم", body: "آپ کی منظوری کی درخواست بغیر فیصلے کے ختم ہو گئی۔" },
  },
  APPROVAL_EXECUTION_STARTED: {
    EN: { title: "Execution Started", body: "Your approved action is now being executed." },
    UR: { title: "عملدرآمد شروع", body: "آپ کے منظور شدہ اقدام پر عملدرآمد شروع ہو گیا ہے۔" },
  },
  APPROVAL_EXECUTED: {
    EN: { title: "Action Executed", body: "Your approved action has been executed successfully." },
    UR: { title: "اقدام مکمل", body: "آپ کا منظور شدہ اقدام کامیابی سے مکمل ہو گیا ہے۔" },
  },
  APPROVAL_EXECUTION_FAILED: {
    EN: { title: "Execution Failed", body: "Your approved action could not be executed." },
    UR: { title: "عملدرآمد ناکام", body: "آپ کا منظور شدہ اقدام مکمل نہیں ہو سکا۔" },
  },
  EMERGENCY_OVERRIDE_USED: {
    EN: { title: "Emergency Override Used", body: "An emergency override was used on a high-risk action." },
    UR: { title: "ہنگامی اختیار استعمال ہوا", body: "ایک حساس اقدام پر ہنگامی اختیار استعمال کیا گیا۔" },
  },

  // ---------- Family/Guardian Portal (STEP 22) ----------
  FAMILY_INVITATION: {
    EN: { title: "Family Invitation", subject: "You've Been Invited on Life Partner Pro", body: "You have been invited to assist a family member's matrimonial process on Life Partner Pro." },
    UR: { title: "خاندانی دعوت نامہ", subject: "آپ کو لائف پارٹنر پرو پر مدعو کیا گیا ہے", body: "آپ کو ایک خاندان کے فرد کے رشتہ کے عمل میں مدد کے لیے مدعو کیا گیا ہے۔" },
  },
  FAMILY_ACCESS_GRANTED: {
    EN: { title: "Family Access Granted", body: "Your access to assist with the matrimonial process has been updated." },
    UR: { title: "خاندانی رسائی منظور", body: "رشتہ کے عمل میں مدد کے لیے آپ کی رسائی کو اپڈیٹ کر دیا گیا ہے۔" },
  },
  FAMILY_ACCESS_REVOKED: {
    EN: { title: "Family Access Revoked", body: "Your access has been revoked. Please contact the applicant for details." },
    UR: { title: "خاندانی رسائی منسوخ", body: "آپ کی رسائی منسوخ کر دی گئی ہے۔ تفصیلات کے لیے درخواست دہندہ سے رابطہ کریں۔" },
  },
  FAMILY_ACCESS_REQUEST: {
    EN: { title: "Family Access Request", body: "A family member has requested additional access to your profile." },
    UR: { title: "خاندانی رسائی کی درخواست", body: "ایک خاندان کے فرد نے آپ کی پروفائل تک اضافی رسائی کی درخواست کی ہے۔" },
  },
  FAMILY_PROPOSAL_SHARED: {
    EN: { title: "A Proposal Was Shared With You", body: "A matrimonial proposal has been shared with you for review." },
    UR: { title: "آپ کے ساتھ تجویز شیئر کی گئی", body: "جائزے کے لیے آپ کے ساتھ ایک رشتہ کی تجویز شیئر کی گئی ہے۔" },
  },
  FAMILY_PROPOSAL_UPDATED: {
    EN: { title: "Shared Proposal Updated", body: "A proposal shared with you has been updated." },
    UR: { title: "شیئر شدہ تجویز اپڈیٹ", body: "آپ کے ساتھ شیئر کردہ تجویز کو اپڈیٹ کر دیا گیا ہے۔" },
  },
  FAMILY_DECISION_REQUESTED: {
    EN: { title: "Confirmation Needed", subject: "A Family Suggestion Needs Your Confirmation", body: "A family member has suggested a response to a proposal. Please review and confirm." },
    UR: { title: "تصدیق درکار ہے", subject: "ایک خاندانی تجویز کو آپ کی تصدیق درکار ہے", body: "ایک خاندان کے فرد نے تجویز پر جواب تجویز کیا ہے۔ براہ کرم جائزہ لے کر تصدیق کریں۔" },
  },
  FAMILY_MEETING_UPDATED: {
    EN: { title: "Meeting Update", body: "A meeting you're coordinating on has been updated." },
    UR: { title: "ملاقات میں تبدیلی", body: "جس ملاقات میں آپ رابطہ کار ہیں اسے اپڈیٹ کر دیا گیا ہے۔" },
  },
  FAMILY_PERMISSION_EXPIRING: {
    EN: { title: "Family Access Expiring Soon", body: "A family member's access is expiring soon." },
    UR: { title: "خاندانی رسائی جلد ختم ہو رہی ہے", body: "ایک خاندان کے فرد کی رسائی جلد ختم ہونے والی ہے۔" },
  },
  FAMILY_PERMISSION_EXPIRED: {
    EN: { title: "Family Access Expired", body: "A family member's access has expired." },
    UR: { title: "خاندانی رسائی ختم", body: "ایک خاندان کے فرد کی رسائی ختم ہو چکی ہے۔" },
  },
};
