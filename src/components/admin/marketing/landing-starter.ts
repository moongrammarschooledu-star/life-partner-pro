// A neutral starting template for a new landing page (add a FORM_EMBED section in the editor once a published lead form exists).
// Wording follows the approved phrase library: it describes a private, verified matchmaking PROCESS and makes no outcome, exclusivity or member-count claim.

export function STARTER_SECTIONS(language: "EN" | "UR") {
  if (language === "UR") {
    return [
      { id: "hero", type: "HERO", heading: "نجی اور محفوظ رشتہ تلاش کرنے کا عمل", subtitle: "اپنی معلومات کے ساتھ اپنی رضامندی سے آغاز کریں۔" },
      { id: "steps", type: "STEPS", heading: "یہ کیسے کام کرتا ہے", items: [
        { title: "فارم بھریں", text: "اپنی بنیادی معلومات اور رابطے کا طریقہ بتائیں۔" },
        { title: "ہماری ٹیم رابطہ کرے گی", text: "ہماری ٹیم آپ کی رضامندی سے رابطہ کرے گی اور اگلے مراحل سمجھائے گی۔" },
      ] },
      { id: "disclaimer", type: "DISCLAIMER", body: "ہم کسی نتیجے کی ضمانت نہیں دیتے۔ آپ کی معلومات رازداری کی پالیسی کے مطابق استعمال ہوتی ہیں۔" },
    ];
  }
  return [
    { id: "hero", type: "HERO", heading: "A private, careful way to begin your search", subtitle: "Share a few details and choose how you would like to be contacted." },
    { id: "steps", type: "STEPS", heading: "How it works", items: [
      { title: "Tell us about yourself", text: "Share your basic details and your preferred way to be contacted." },
      { title: "Our team gets in touch", text: "With your consent, a member of our team contacts you and explains the next steps." },
      { title: "Register at your own pace", text: "Create your profile when you are ready. Identity checks are done by our team." },
    ] },
    { id: "faq", type: "FAQ", heading: "Common questions", items: [
      { q: "Is my information private?", a: "Your details are used only as described in the privacy notice linked from the form." },
      { q: "Will you contact me without asking?", a: "We contact you only through the channels you choose on the form." },
    ] },
    { id: "disclaimer", type: "DISCLAIMER", body: "We do not guarantee any outcome. Profiles are not publicly browsable, and your details are handled in line with our privacy notice." },
  ];
}
