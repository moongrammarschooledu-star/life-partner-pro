"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
}

// Renders nothing for an anonymous visitor (no applicant session cookie
// established yet) — a 401 from /api/my-notifications is treated as "not
// signed in," not an error.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/my-notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setSignedIn(true);
        setItems(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!signedIn) return null;

  async function markRead(id: string) {
    await fetch(`/api/my-notifications/${id}/read`, { method: "POST" });
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)) ?? null);
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
          </div>
          {items === null || items.length === 0 ? (
            <p className="p-4 text-sm text-muted">No notifications yet.</p>
          ) : (
            <div className="max-h-96 divide-y divide-border overflow-y-auto">
              {items.slice(0, 8).map((item) => (
                <Link
                  key={item.id}
                  href={item.actionUrl ?? "/my-notifications"}
                  onClick={() => {
                    setOpen(false);
                    if (!item.readAt) markRead(item.id);
                  }}
                  className={`block px-4 py-3 text-sm hover:bg-surface-muted ${item.readAt ? "" : "bg-primary/5"}`}
                >
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{item.body}</p>
                </Link>
              ))}
            </div>
          )}
          <Link href="/my-notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-2 text-center text-xs font-medium text-primary hover:underline">
            View All Notifications
          </Link>
        </div>
      )}
    </div>
  );
}
