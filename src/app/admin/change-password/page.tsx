"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Loader2, KeyRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

// Standalone route (outside the (shell) group) so the redirect in
// src/app/admin/(shell)/layout.tsx for AdminUser.mustResetPassword can't
// loop — this page is the only way out of that redirect.
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/admin/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not change password.");
      setLoading(false);
      return;
    }
    router.push("/admin/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8">
          <div className="flex flex-col items-center gap-2 mb-6">
            <Image src="/logo-icon.png" alt="Life Partner Pro" width={56} height={56} className="h-14 w-14" priority />
            <h1 className="font-heading text-xl font-semibold">Set a New Password</h1>
            <p className="flex items-center gap-1 text-xs text-muted">
              <KeyRound className="h-3.5 w-3.5" /> Your access was reset — choose a new password to continue.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Temporary Password" htmlFor="currentPassword">
              <Input id="currentPassword" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </Field>
            <Field label="New Password" htmlFor="newPassword">
              <Input id="newPassword" type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <Field label="Confirm New Password" htmlFor="confirmPassword">
              <Input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Set Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
