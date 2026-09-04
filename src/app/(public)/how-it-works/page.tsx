import Link from "next/link";
import { ClipboardList, FileText, Search, Sparkles, MessagesSquare, Users, CalendarCheck2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

const STEPS = [
  { icon: ClipboardList, title: "Create Your Profile", description: "Start the secure, multi-step registration form — it takes about 10 minutes." },
  { icon: FileText, title: "Submit Personal Details", description: "Share your background, family, education, career, and what you're looking for in a partner." },
  { icon: Search, title: "Admin Reviews Your Profile", description: "A member of our team personally reviews and verifies every submission before it's used for matching." },
  { icon: Sparkles, title: "Suitable Matches Are Identified", description: "Our weighted compatibility engine highlights the most suitable proposals for admin review." },
  { icon: MessagesSquare, title: "Proposal Is Discussed", description: "An admin reviews the match, and if it looks promising, prepares a proposal." },
  { icon: Users, title: "Families Are Connected", description: "With consent from both sides, we facilitate an introduction and share contact details." },
  { icon: CalendarCheck2, title: "Follow-up & Final Decision", description: "We stay involved through meetings and follow-ups until a decision is reached." },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="font-heading text-3xl font-semibold sm:text-4xl">How It Works</h1>
        <p className="mt-3 text-muted">A professional, private, step-by-step matchmaking process.</p>
      </div>

      <ol className="relative mt-12 space-y-8 border-l border-border pl-8">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative">
            <span className="absolute -left-[41px] flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-primary text-sm font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
              <step.icon className="h-6 w-6 shrink-0 text-primary" />
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="mt-1 text-sm text-muted">{step.description}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12 text-center">
        <Link href="/register" className={buttonClass({ size: "lg" })}>
          Create My Profile
        </Link>
      </div>
    </div>
  );
}
