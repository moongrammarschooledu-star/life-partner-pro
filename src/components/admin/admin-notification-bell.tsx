"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

// Persisted-Notification-backed bell (STEP 9) — a NEW, separate component
// from NotificationsPanel (the existing live-computed "action needed"
// aggregate, left untouched) so the two signals never get confused.
export function AdminNotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    fetch("/api/admin/notification-inbox")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      });
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markRead(id: string) {
    await fetch("/api/admin/notification-inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  async function markAllRead() {
    await fetch("/api/admin/notification-inbox/mark-all-read", { method: "POST" });
    load();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notification Inbox"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
      >
        <BellRing className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Notification Inbox</p>
              <p className="text-xs text-muted">Mutual interest, meetings, flags, and more.</p>
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items === null ? (
            <p className="p-4 text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted">No notifications yet.</p>
          ) : (
            <div className="max-h-96 divide-y divide-border overflow-y-auto">
              {items.map((item) => (
                <Link
                  key={item.id}
                  href={item.actionUrl ?? "#"}
                  onClick={() => {
                    setOpen(false);
                    if (!item.readAt) markRead(item.id);
                  }}
                  className={`block px-4 py-3 text-sm hover:bg-surface-muted ${item.readAt ? "" : "bg-primary/5"}`}
                >
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{item.body}</p>
                  <p className="mt-1 text-[10px] text-muted">{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</p>
                </Link>
              ))}
            </div>
          )}
          <Link
            href="/admin/communication-center"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2 text-center text-xs font-medium text-primary hover:underline"
          >
            View All Notifications
          </Link>
        </div>
      )}
    </div>
  );
}
