import { ClipboardList, FileText, BadgeCheck, Search, Mail, Reply, Handshake, KeyRound, Users, CalendarCheck2, MessagesSquare, CheckCircle2 } from "lucide-react";
import { PageShell, PageHeading, Notice, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/how-it-works");

const STEPS = [
  { icon: ClipboardList, title: "Create your profile", text: "Start the secure registration form. It takes about ten minutes and can be saved on your device and finished later. You receive a Profile ID to sign in with." },
  { icon: FileText, title: "Complete your matrimonial profile", text: "Share your background, education, career, family and lifestyle, and what you are looking for in a partner. Optional sections are marked as optional." },
  { icon: BadgeCheck, title: "Verification and review", text: "Your contact details are confirmed, and a person on our team reviews your profile. Where the verification policy requires it, identity or other documents are checked." },
  { icon: Search, title: "Matching", text: "The platform compares profiles with partner requirements and highlights possible matches. A person reviews them before anything is prepared." },
  { icon: Mail, title: "Proposal", text: "If a match looks promising, our team prepares a proposal and presents it to both sides." },
  { icon: Reply, title: "Response", text: "Each side reviews the proposal and responds: interested or not interested. You may decline, and you may give a reason." },
  { icon: Handshake, title: "Mutual interest", text: "Only when both sides are interested does the process continue." },
  { icon: KeyRound, title: "Contact permission", text: "Contact details are shared only after an explicit contact-permission step, which is recorded." },
  { icon: Users, title: "Family coordination", text: "Families can be introduced and can coordinate. Family members take part only if the applicant has invited them, within the permissions the applicant sets." },
  { icon: CalendarCheck2, title: "Meeting", text: "A meeting can be requested, scheduled and followed up through the platform." },
  { icon: MessagesSquare, title: "Further discussion", text: "Both sides take the time they need to talk and decide. Nobody is pushed to proceed." },
  { icon: CheckCircle2, title: "Finalisation", text: "If both sides and their families decide to go ahead, the outcome is recorded. The platform does not arrange or perform marriages." },
];

export default function HowItWorksPage() {
  return (
    <PageShell path="/how-it-works" title="How It Works" description="The full process from creating a profile to a family meeting.">
      <PageHeading title="How Life Partner Pro works" lead="A private, step-by-step process. You stay in control at every stage, and nothing is shared without consent." />
      <ol className="relative space-y-6 border-l border-border pl-8">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative">
            <span className="absolute -left-[41px] flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
              {i + 1}
            </span>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
              <s.icon className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-medium">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h2>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <Notice title="What the platform does and does not do">
          Life Partner Pro facilitates introductions through a guided, consent-based process. It does not guarantee a match, a response, a proposal or a marriage.
        </Notice>
      </div>
      <CtaBand title="Ready to begin?" text="Creating a profile is private. Your personal information is not publicly displayed." primary={{ href: "/register", label: "Create Your Profile" }} secondary={{ href: "/faq", label: "Read the FAQ" }} />
    </PageShell>
  );
}
