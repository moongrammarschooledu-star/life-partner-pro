"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Mail } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

// Spec §22 — identity reconfirmation before a high-risk account action.
// Two-step: send an email OTP, confirm it for a short-lived reauth token,
// then invoke the caller's action with that token.
export function ReauthDialog({
  open,
  title,
  description,
  danger,
  onCancel,
  onConfirmed,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirmed: (reauthToken: string) => Promise<void>;
  children?: ReactNode;
}) {
  const { show } = useToast();
  const [stage, setStage] = useState<"start" | "code">("start");
  const [code, setCode] = useState("");
  const [destinationMasked, setDestinationMasked] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage("start");
    setCode("");
    setDestinationMasked("");
  }

  async function sendCode() {
    setBusy(true);
    try {
      const res = await fetch("/api/my-account/reauth/send", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDestinationMasked(json.destinationMasked);
      setStage("code");
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not send code.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndProceed() {
    setBusy(true);
    try {
      const res = await fetch("/api/my-account/reauth/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await onConfirmed(json.reauthToken);
      reset();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not verify code.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      danger={danger}
      confirmLabel={stage === "start" ? "Send Code" : "Confirm"}
      confirmDisabled={busy || (stage === "code" && !code.trim())}
      onConfirm={stage === "start" ? sendCode : confirmAndProceed}
      onCancel={() => { reset(); onCancel(); }}
    >
      {stage === "start" && children}
      {stage === "code" && (
        <Field label={`Enter the code sent to ${destinationMasked}`} htmlFor="reauth-code" hint="Required to confirm your identity for this action.">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted" />
            <Input id="reauth-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        </Field>
      )}
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
    </ConfirmDialog>
  );
}
