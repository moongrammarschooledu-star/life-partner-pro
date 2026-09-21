import type { AiPayload, AiLanguage, CommunicationKind } from "@/lib/ai/types";

// Spec §14/§15/§49 — communication drafts. A draft is TEXT for an admin to
// review and edit; it is never sent from here (sending stays the existing
// Step 9 flow with an explicit admin confirmation). Drafts contain:
//   • no contact details, no internal notes, no private or family information
//   • no guarantees, no pressure, no deadlines, no manipulative wording
// Recipient-specific facts are left as [bracketed placeholders] for the admin.

interface Template {
  subject: string;
  body: string;
}

const EN: Record<CommunicationKind, Template> = {
  PROPOSAL_MESSAGE: {
    subject: "A proposal for your consideration",
    body:
      "Assalam-o-Alaikum [Name],\n\nWe hope you are well. After reviewing the profiles, our team would like to share a proposal for your consideration. Please take the time you need to review it with your family. If you would like more information, or have any questions, we are happy to help.\n\nRegards,\nLife Partner Pro",
  },
  INFORMATION_REQUEST: {
    subject: "A few details to complete your profile",
    body:
      "Assalam-o-Alaikum [Name],\n\nThank you for registering with Life Partner Pro. To help us review your profile properly, could you please share the following when convenient: [details needed]. Providing them is optional and at your own pace.\n\nRegards,\nLife Partner Pro",
  },
  FOLLOW_UP: {
    subject: "A gentle follow-up",
    body:
      "Assalam-o-Alaikum [Name],\n\nWe wanted to gently follow up on our earlier message about [topic]. Whenever you have had a chance to consider it, we would be glad to hear your thoughts. There is no rush.\n\nRegards,\nLife Partner Pro",
  },
  MEETING_COORDINATION: {
    subject: "Arranging a convenient time",
    body:
      "Assalam-o-Alaikum [Name],\n\nIf both families are comfortable, we would be glad to help arrange a meeting. Could you let us know which days and times would suit you? We will share the options with the other side only once you have agreed.\n\nRegards,\nLife Partner Pro",
  },
  REMINDER: {
    subject: "A friendly reminder",
    body:
      "Assalam-o-Alaikum [Name],\n\nThis is a friendly reminder about [topic]. Please respond whenever it is convenient for you; we are here if you need any help.\n\nRegards,\nLife Partner Pro",
  },
  STATUS_UPDATE: {
    subject: "An update on your profile",
    body:
      "Assalam-o-Alaikum [Name],\n\nWe would like to share a brief update: [status update]. If you have any questions, please feel free to ask us.\n\nRegards,\nLife Partner Pro",
  },
};

const UR: Record<CommunicationKind, Template> = {
  PROPOSAL_MESSAGE: {
    subject: "آپ کی خدمت میں ایک رشتہ",
    body:
      "السلام علیکم [نام]،\n\nامید ہے آپ خیریت سے ہوں گے۔ پروفائلز کا جائزہ لینے کے بعد ہماری ٹیم آپ کے غور کے لیے ایک رشتہ پیش کرنا چاہتی ہے۔ براہِ کرم اپنے گھر والوں کے ساتھ اطمینان سے جائزہ لیں۔ مزید معلومات یا کوئی سوال ہو تو ہم حاضر ہیں۔\n\nخیر اندیش،\nلائف پارٹنر پرو",
  },
  INFORMATION_REQUEST: {
    subject: "پروفائل مکمل کرنے کے لیے چند تفصیلات",
    body:
      "السلام علیکم [نام]،\n\nلائف پارٹنر پرو میں رجسٹر ہونے کا شکریہ۔ آپ کی پروفائل کا درست جائزہ لینے کے لیے، جب سہولت ہو، براہِ کرم یہ تفصیلات فراہم کر دیں: [درکار تفصیلات]۔ یہ آپ کی مرضی اور سہولت کے مطابق ہے۔\n\nخیر اندیش،\nلائف پارٹنر پرو",
  },
  FOLLOW_UP: {
    subject: "نرمی سے یاد دہانی",
    body:
      "السلام علیکم [نام]،\n\nہم اپنے پچھلے پیغام بابت [موضوع] پر نرمی سے رابطہ کر رہے ہیں۔ جب آپ غور کر چکیں تو ہمیں آپ کی رائے کا انتظار رہے گا۔ کوئی جلدی نہیں۔\n\nخیر اندیش،\nلائف پارٹنر پرو",
  },
  MEETING_COORDINATION: {
    subject: "ملاقات کے لیے مناسب وقت",
    body:
      "السلام علیکم [نام]،\n\nاگر دونوں خاندان راضی ہوں تو ہم ملاقات کا انتظام کرنے میں خوشی محسوس کریں گے۔ براہِ کرم بتا دیں کہ کون سے دن اور وقت آپ کے لیے مناسب ہوں گے۔ آپ کی رضامندی کے بعد ہی دوسری جانب کو آگاہ کیا جائے گا۔\n\nخیر اندیش،\nلائف پارٹنر پرو",
  },
  REMINDER: {
    subject: "دوستانہ یاد دہانی",
    body:
      "السلام علیکم [نام]،\n\nیہ [موضوع] کے بارے میں ایک دوستانہ یاد دہانی ہے۔ جب سہولت ہو جواب دے دیجیے؛ کسی مدد کی ضرورت ہو تو ہم حاضر ہیں۔\n\nخیر اندیش،\nلائف پارٹنر پرو",
  },
  STATUS_UPDATE: {
    subject: "آپ کی پروفائل کے بارے میں اطلاع",
    body:
      "السلام علیکم [نام]،\n\nہم آپ کو مختصر اطلاع دینا چاہتے ہیں: [اطلاع]۔ کوئی سوال ہو تو بلا جھجک پوچھیے۔\n\nخیر اندیش،\nلائف پارٹنر پرو",
  },
};

const RU: Record<CommunicationKind, Template> = {
  PROPOSAL_MESSAGE: {
    subject: "Aap ki khidmat mein aik rishta",
    body:
      "Assalam-o-Alaikum [Naam],\n\nUmeed hai aap khairiyat se hon ge. Profiles ka jaiza lene ke baad hamari team aap ke ghaur ke liye aik rishta pesh karna chahti hai. Baraye meharbani apne ghar walon ke saath itminan se jaiza lein. Mazeed maloomat ya koi sawal ho to hum hazir hain.\n\nKhair andesh,\nLife Partner Pro",
  },
  INFORMATION_REQUEST: {
    subject: "Profile mukammal karne ke liye chand tafseelat",
    body:
      "Assalam-o-Alaikum [Naam],\n\nLife Partner Pro mein register hone ka shukriya. Aap ki profile ka durust jaiza lene ke liye, jab sahulat ho, baraye meharbani yeh tafseelat farahem kar dein: [darkar tafseelat]. Yeh aap ki marzi aur sahulat ke mutabiq hai.\n\nKhair andesh,\nLife Partner Pro",
  },
  FOLLOW_UP: {
    subject: "Narmi se yaad dehani",
    body:
      "Assalam-o-Alaikum [Naam],\n\nHum apne pichle paigham babat [mauzu] par narmi se rabta kar rahe hain. Jab aap ghaur kar chukein to hamein aap ki raye ka intezar rahe ga. Koi jaldi nahi.\n\nKhair andesh,\nLife Partner Pro",
  },
  MEETING_COORDINATION: {
    subject: "Mulaqat ke liye munasib waqt",
    body:
      "Assalam-o-Alaikum [Naam],\n\nAgar dono khandan razi hon to hum mulaqat ka intezam karne mein khushi mehsoos karein ge. Baraye meharbani bata dein ke kaun se din aur waqt aap ke liye munasib hon ge. Aap ki razamandi ke baad hi doosri janib ko agah kiya jaye ga.\n\nKhair andesh,\nLife Partner Pro",
  },
  REMINDER: {
    subject: "Dostana yaad dehani",
    body:
      "Assalam-o-Alaikum [Naam],\n\nYeh [mauzu] ke baare mein aik dostana yaad dehani hai. Jab sahulat ho jawab de dijiye; kisi madad ki zaroorat ho to hum hazir hain.\n\nKhair andesh,\nLife Partner Pro",
  },
  STATUS_UPDATE: {
    subject: "Aap ki profile ke baare mein itla",
    body:
      "Assalam-o-Alaikum [Naam],\n\nHum aap ko mukhtasar itla dena chahte hain: [itla]. Koi sawal ho to be-jhijhak poochiye.\n\nKhair andesh,\nLife Partner Pro",
  },
};

const TEMPLATES: Record<AiLanguage, Record<CommunicationKind, Template>> = { en: EN, ur: UR, "roman-ur": RU };

export const DRAFT_LIMITATIONS = [
  "This is a draft for an admin to review and edit. It has not been sent.",
  "Replace every [placeholder] before sending, and confirm the member has consented to this communication and channel.",
  "The draft contains no contact details or private information; do not add any that the recipient has not consented to receive.",
];

export function buildCommunicationDraft(params: { kind: CommunicationKind; language: AiLanguage; recipientCode: string }): AiPayload {
  const t = TEMPLATES[params.language][params.kind];
  return {
    summary: `Draft ${params.kind.replace(/_/g, " ").toLowerCase()} (${params.language}) for ${params.recipientCode}. Review before sending.`,
    evidence: [],
    alignedAreas: [],
    potentialConflicts: [],
    missingInformation: [],
    verificationQuestions: ["Has the member consented to receive this message on the chosen channel?", "Are all [placeholders] filled in and is the wording appropriate for this member?"],
    suggestedNextStep: "Edit the draft, then send it through the normal communication flow with your explicit confirmation.",
    limitations: DRAFT_LIMITATIONS,
    sufficiency: "SUFFICIENT",
    data: { draft: { subject: t.subject, body: t.body, language: params.language, kind: params.kind }, sent: false },
  };
}
