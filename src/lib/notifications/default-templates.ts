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
};
