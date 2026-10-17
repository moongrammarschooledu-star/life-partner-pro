"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2, MessageCircle, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { whatsappChatUrl } from "@/lib/whatsapp-link";
import { comparisonShareMessage } from "@/lib/proposal-share-message";

interface Side {
  id: string;
  fullName: string;
  profileCode: string;
}

type Comparison =
  | { available: false; reason: string }
  | {
      available: true;
      overall: string;
      categories: Array<{ label: string; text: string; status: string }>;
      sides: Array<{ label: string; you: string; other: string }>;
    };

const STATUS_DOT: Record<string, string> = { compatible: "bg-success", partial: "bg-warning", incompatible: "bg-danger", unknown: "bg-border" };

// The two people of a proposal side by side (the same safe summary the shareable sheet carries), and a row per person to send it to: download the sheet (PDF) and open
// WhatsApp on their number with the message ready. WhatsApp cannot attach a file from a link, so the admin attaches the downloaded sheet and presses send themself.
export function ProposalComparisonShare({ proposalId, a, b, matchScore }: { proposalId: string; a: Side; b: Side; matchScore: number | null }) {
  const { show } = useToast();
  const [data, setData] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/proposals/${proposalId}/comparison`)
      .then((r) => r.json())
      .then((json) => !cancelled && setData(json.available ? json : { available: false, reason: json.reason ?? json.error ?? "The comparison is not available." }))
      .catch(() => !cancelled && setData({ available: false, reason: "The comparison could not be loaded." }));
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  // Opens the person's WhatsApp chat. The number is revealed through the audited contact route; the chat window is opened first so the browser does not block it.
  async function openWhatsApp(side: Side) {
    const win = window.open("", "_blank");
    setBusy(side.id);
    try {
      const res = await fetch(`/api/admin/profiles/${side.id}/contact`);
      if (!res.ok) throw new Error();
      const contact = (await res.json()) as { mobileNumber: string; whatsappNumber: string | null };
      const url = whatsappChatUrl(contact.whatsappNumber || contact.mobileNumber, comparisonShareMessage({ fullName: side.fullName, matchPercent: matchScore }));
      if (!url) {
        win?.close();
        show("This person has no usable WhatsApp or mobile number. Correct it in their contact details first.", "error");
        return;
      }
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch {
      win?.close();
      show("Could not load the contact number.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="h-4 w-4 text-primary" /> Compare and share
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!data ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        ) : !data.available ? (
          <p className="text-sm text-muted">{data.reason}</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="p-2.5">Detail</th>
                    <th className="p-2.5">
                      {a.fullName} <span className="font-mono normal-case">{a.profileCode}</span>
                    </th>
                    <th className="p-2.5">
                      {b.fullName} <span className="font-mono normal-case">{b.profileCode}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.sides
                    .filter((row) => row.label !== "Name")
                    .map((row) => (
                      <tr key={row.label} className="border-t border-border">
                        <td className="p-2.5 text-muted">{row.label}</td>
                        <td className="p-2.5">{row.you}</td>
                        <td className="p-2.5">{row.other}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">How well they match: {data.overall}</p>
              <ul className="space-y-1 text-sm">
                {data.categories.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[c.status] ?? "bg-border"}`} />
                    <span>
                      <span className="font-medium">{c.label}:</span> <span className="text-muted">{c.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Send the comparison to each side, one by one</p>
              {([
                ["A", a],
                ["B", b],
              ] as const).map(([which, side]) => (
                <div key={which} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">{side.fullName}</p>
                    <p className="text-xs text-muted">{side.profileCode}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={`/api/admin/proposals/${proposalId}/comparison-pdf?for=${which}`} className={buttonClass({ variant: "outline", size: "sm" })}>
                      <FileDown className="h-4 w-4" /> 1. Download PDF
                    </a>
                    <button type="button" onClick={() => openWhatsApp(side)} disabled={busy === side.id} className={buttonClass({ variant: "outline", size: "sm" })}>
                      {busy === side.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4 text-primary" />} 2. WhatsApp
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted">
                WhatsApp opens on that person&apos;s number with the message ready. Attach the downloaded PDF (paperclip) and press send. The sheet carries both names and the safe
                summary only: never a photo, contact detail, area, income or family detail. Each download and each number lookup is recorded in the audit log.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
