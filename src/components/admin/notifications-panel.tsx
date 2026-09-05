"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ShieldCheck, ShieldAlert, CalendarClock, Sparkles, MessageCircleHeart, Heart, Share2, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NotificationEntry } from "@/app/api/admin/notifications/route";

const ICONS: Record<NotificationEntry["type"], typeof Bell> = {
  verification: ShieldCheck,
  follow_up: CalendarClock,
  match: Sparkles,
  proposal: MessageCircleHeart,
  mutual_interest: Heart,
  contact_permission: Share2,
  re_verification: ShieldAlert,
  duplicate_flag: Flag,
};

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NotificationEntry[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/admin/notifications")
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []));
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const total = entries?.reduce((sum, e) => sum + e.count, 0) ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted">What needs your attention right now.</p>
          </div>
          {entries === null ? (
            <p className="p-4 text-sm text-muted">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-sm text-muted">You&apos;re all caught up.</p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((e) => {
                const Icon = ICONS[e.type];
                return (
                  <div key={e.type}>
                    <Link
                      href={e.href}
                      onClick={() => setOpen(false)}
                      className={cn("flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-muted")}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{e.label}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold">{e.count}</span>
                    </Link>
                    {e.examples && e.examples.length > 0 && (
                      <div className="space-y-1 px-4 pb-3">
                        {e.examples.map((ex, i) => (
                          <Link
                            key={i}
                            href={ex.href}
                            onClick={() => setOpen(false)}
                            className="flex items-center justify-between rounded-md bg-surface-muted px-2.5 py-1.5 text-xs hover:bg-border"
                          >
                            <span>
                              {ex.profileACode} ↔ {ex.profileBCode}
                            </span>
                            <span className="font-semibold text-primary">{ex.score}%</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
