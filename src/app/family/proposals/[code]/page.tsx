"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Heart, X, HelpCircle, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface ProposalDetail {
  proposalCode: string;
  status: string;
  canComment: boolean;
  canRespond: boolean;
  otherProfile: { fullName: string; age: number; city: string; country: string; education?: string; profession?: string; maritalStatus?: string; familyType?: string };
  compatibilityTier?: string;
  highlights?: string[];
  differences?: string[];
}

export default function FamilyProposalDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<ProposalDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [comment, setComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [decisionComment, setDecisionComment] = useState("");
  const [suggested, setSuggested] = useState(false);

  function load() {
    fetch(`/api/family/proposals/${code}`).then((r) => {
      if (!r.ok) { setNotFound(true); return null; }
      return r.json();
    }).then((j) => j && setData(j));
  }
  useEffect(load, [code]);

  async function submitComment() {
    if (!comment.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/family/proposals/${code}/comment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: comment, visibility: "FAMILY_SHARED" }) });
      if (res.ok) { show("Comment added.", "success"); setComment(""); }
      else show((await res.json()).error ?? "Could not add comment.", "error");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function suggestResponse(decision: string) {
    setSuggesting(true);
    try {
      const res = await fetch(`/api/family/proposals/${code}/suggest-response`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment: decisionComment || undefined }) });
      if (res.ok) { show("Suggestion sent — the applicant will confirm it before it becomes official.", "success"); setSuggested(true); }
      else show((await res.json()).error ?? "Could not submit suggestion.", "error");
    } finally {
      setSuggesting(false);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
        <p className="text-sm text-muted">Proposal not found or not shared with you.</p>
        <Link href="/family/proposals" className="mt-2 inline-block text-sm text-primary hover:underline">Back to Proposals</Link>
      </div>
    );
  }

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <Link href="/family/proposals" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Proposals</Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{data.otherProfile.fullName}, {data.otherProfile.age}</span>
            <Badge variant="muted">{data.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{data.otherProfile.city}, {data.otherProfile.country}</p>
          {data.otherProfile.education && <p>{data.otherProfile.education} · {data.otherProfile.profession}</p>}
          {data.otherProfile.maritalStatus && <p>{formatEnumLabel(data.otherProfile.maritalStatus)}{data.otherProfile.familyType ? ` · ${formatEnumLabel(data.otherProfile.familyType)} family` : ""}</p>}
          {data.compatibilityTier && <p className="font-medium text-primary">{data.compatibilityTier}</p>}
        </CardContent>
      </Card>

      {(data.highlights?.length || data.differences?.length) ? (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            {data.highlights?.map((h, i) => <p key={i} className="text-success">✓ {h}</p>)}
            {data.differences?.map((d, i) => <p key={i} className="text-muted">• {d}</p>)}
          </CardContent>
        </Card>
      ) : null}

      {data.canRespond && !suggested && (
        <Card>
          <CardHeader><CardTitle className="text-base">Suggest a Response</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted">You are responding as an authorized family representative. This is only a suggestion — the applicant must confirm it before it becomes official.</p>
            <Textarea placeholder="Optional note" value={decisionComment} onChange={(e) => setDecisionComment(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => suggestResponse("INTERESTED")} disabled={suggesting}><Heart className="h-4 w-4" /> Interested</Button>
              <Button size="sm" variant="outline" onClick={() => suggestResponse("NOT_INTERESTED")} disabled={suggesting}><X className="h-4 w-4" /> Not Interested</Button>
              <Button size="sm" variant="outline" onClick={() => suggestResponse("NEED_MORE_INFO")} disabled={suggesting}><HelpCircle className="h-4 w-4" /> Need More Info</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {data.canComment && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" /> Add a Comment</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your thoughts with the applicant…" />
            <Button size="sm" onClick={submitComment} disabled={!comment.trim() || submittingComment}>
              {submittingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Post Comment
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
