// FAQ content for /faq and the home page. Every answer describes how the platform actually behaves today (registration wizard, e-mail sign-in
// code, staff review, verification policy, consent-based contact sharing, optional family access). It makes no promise about outcomes.
// Wording touching deletion/retention is legal-review-sensitive: see PUBLIC_WEBSITE_AUDIT.md.

export interface FaqItem {
  question: string;
  answer: string;
}
export interface FaqCategory {
  id: string;
  title: string;
  items: FaqItem[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: "general",
    title: "General",
    items: [
      {
        question: "What is Life Partner Pro?",
        answer: "Life Partner Pro is a private matrimonial platform. Applicants, and their families if they choose, create a structured profile. A guided, consent-based process then helps explore compatible proposals, with people from our team reviewing each step.",
      },
      {
        question: "Is this a dating app?",
        answer: "No. There is no swiping, no public likes, followers or comments, and no open messaging between applicants. Introductions happen through a guided process and only with consent.",
      },
      {
        question: "How does matchmaking work?",
        answer: "You describe yourself and what you are looking for in a partner. The platform compares profiles against those requirements and highlights possible matches for a person on our team to review. If a proposal is prepared, each side reviews it and chooses whether to continue. The platform facilitates the process; it does not guarantee a match or a marriage.",
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy",
    items: [
      {
        question: "Who can see my information?",
        answer: "Your profile is not public and there is no public directory of applicants. It is visible to authorised staff who review and match profiles, and to family members you invite, within the permissions you set. Information that appears in a proposal is limited by the platform's privacy rules.",
      },
      {
        question: "Are my phone and WhatsApp numbers public?",
        answer: "No. Contact details are not displayed publicly. They are shared only at a later step, after both sides have shown interest and the contact-sharing approval has been completed.",
      },
      {
        question: "Can I delete my account?",
        answer: "Once signed in, the privacy area lets you request access to your data, a correction, an export, restriction of processing, withdrawal of consent or deletion. You can also ask through Support. Some records may have to be kept for a limited time for legal, security or accounting reasons.",
      },
    ],
  },
  {
    id: "verification",
    title: "Verification",
    items: [
      {
        question: "How does verification work?",
        answer: "Verification can include confirming your contact details with one-time codes, a review of your profile by our team, and, where the verification policy requires it, identity, education or employment documents. Your verification status is shown in your account.",
      },
      {
        question: "Is identity verification required?",
        answer: "It depends on the verification policy in force. Where a check is required, the site tells you exactly what is needed. Verification reduces risk; it cannot prove that every statement in a profile is accurate.",
      },
    ],
  },
  {
    id: "matching",
    title: "Matching",
    items: [
      {
        question: "How are potential matches identified?",
        answer: "The platform compares profile details with each applicant's stated partner requirements, using weights configured by our team, and a person reviews the result before any proposal is prepared.",
      },
      {
        question: "Can I set partner preferences?",
        answer: "Yes. Partner requirements are part of your profile and can be updated later. They are what the platform compares other profiles against.",
      },
    ],
  },
  {
    id: "proposals",
    title: "Proposals",
    items: [
      {
        question: "How do proposals work?",
        answer: "A proposal is prepared by our team and shown to both sides. Each side reviews it and responds. If both are interested, a contact-permission step follows, then contact between families and, if everyone agrees, a meeting.",
      },
      {
        question: "Can I decline a proposal?",
        answer: "Yes. You can respond that you are not interested, and you may give a reason.",
      },
    ],
  },
  {
    id: "family",
    title: "Family",
    items: [
      {
        question: "Can my family participate?",
        answer: "Yes, if you want them to. Family access is optional and by invitation. You decide what each family member may see and do, and you can change or withdraw that access.",
      },
    ],
  },
  {
    id: "safety",
    title: "Safety",
    items: [
      {
        question: "How can I report suspicious activity?",
        answer: "If you are signed in, use the Report a Concern page. Anyone can also contact Support. Reports are reviewed by our team.",
      },
    ],
  },
  {
    id: "membership",
    title: "Membership",
    items: [
      {
        question: "What does membership provide?",
        answer: "Packages provide the platform features and limits listed on the Pricing page. Membership does not guarantee a match, a response or a marriage, and a higher package does not mean a better outcome.",
      },
      {
        question: "How do cancellations work?",
        answer: "Orders and subscriptions are managed in your Packages & Billing area. An order that has not been paid can be cancelled there. Refunds, where applicable, follow the refund note shown for the package and are handled by our team.",
      },
    ],
  },
];

export function allFaqItems(): FaqItem[] {
  return FAQ_CATEGORIES.flatMap((c) => c.items);
}
