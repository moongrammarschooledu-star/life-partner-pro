"use client";

import { useState } from "react";
import { Lock, Eye, Phone, MessageCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

interface Contact {
  mobileNumber: string;
  whatsappNumber: string | null;
  email: string;
  preferredContactMethod: string;
}

export function ContactPanel({ profileId }: { profileId: string }) {
  const { show } = useToast();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);

  async function reveal() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/contact`);
      if (!res.ok) throw new Error();
      setContact(await res.json());
    } catch {
      show("Could not load contact information.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4 text-primary" /> Contact Information
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!contact ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-muted">Hidden by default. Revealing this information is recorded in the audit log.</p>
            <Button size="sm" variant="outline" onClick={reveal} disabled={loading}>
              <Eye className="h-4 w-4" /> {loading ? "Loading..." : "Reveal Contact Info"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted" /> {contact.mobileNumber}
            </p>
            {contact.whatsappNumber && (
              <p className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted" /> {contact.whatsappNumber}
              </p>
            )}
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted" /> {contact.email}
            </p>
            <p className="text-xs text-muted pt-1">Preferred: {contact.preferredContactMethod}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
