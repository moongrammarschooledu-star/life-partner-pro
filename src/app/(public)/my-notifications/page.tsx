"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Bell, CheckCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export default function MyNotificationsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  function load() {
    fetch("/api/my-notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) {
          setItems(json.items ?? []);
          setSignedIn(true);
        } else {
          setSignedIn(false);
        }
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function lookup() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Profile not found.", "error");
        return;
      }
      load();
    } finally {
      setLookingUp(false);
    }
  }

  async function markRead(id: string) {
    await fetch(`/api/my-notifications/${id}/read`, { method: "POST" });
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)) ?? null);
  }

  async function markAllRead() {
    await fetch("/api/my-notifications/mark-all-read", { method: "POST" });
    load();
  }

  if (signedIn === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">My Notifications</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to view your notifications.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} View My Notifications
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const unreadCount = items.filter((i) => !i.readAt).length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">My Notifications</h1>
        <Link href="/my-notifications/preferences" className="text-sm text-primary hover:underline">
          Notification Settings
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted">Updates about your proposals, meetings, and account — never revealing another profile&apos;s details.</p>

      {unreadCount > 0 && (
        <Button size="sm" variant="outline" className="mt-4" onClick={markAllRead}>
          <CheckCheck className="h-4 w-4" /> Mark all as read
        </Button>
      )}

      <Card className="mt-4">
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications yet" />
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => {
                const content = (
                  <>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{item.body}</p>
                    <p className="mt-1 text-xs text-muted">{formatDateTime(item.createdAt)}</p>
                  </>
                );
                return item.actionUrl ? (
                  <Link
                    key={item.id}
                    href={item.actionUrl}
                    onClick={() => !item.readAt && markRead(item.id)}
                    className={`block px-3 py-3 text-sm hover:bg-surface-muted ${item.readAt ? "" : "bg-primary/5"}`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={item.id}
                    onClick={() => !item.readAt && markRead(item.id)}
                    className={`cursor-pointer px-3 py-3 text-sm hover:bg-surface-muted ${item.readAt ? "" : "bg-primary/5"}`}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
