"use client";

import { useEffect, useState } from "react";
import { Loader2, Star, Trash2, RotateCw, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { useToast } from "@/components/ui/toast";

interface PhotoItem {
  id: string;
  mimeType: string;
  isPrimary: boolean;
  createdAt: string;
}

const MAX_PHOTOS = 6;

export default function PhotosPage() {
  const { show } = useToast();
  const [items, setItems] = useState<PhotoItem[] | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/my-profile/photos")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setItems(j?.items ?? []));
  }
  useEffect(load, []);

  async function upload() {
    if (!newFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", newFile);
      const res = await fetch("/api/my-profile/photos", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not upload photo.", "error");
        return;
      }
      show("Photo uploaded.", "success");
      setNewFile(null);
      load();
    } finally {
      setUploading(false);
    }
  }

  async function setPrimary(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/my-profile/photos/${id}/set-primary`, { method: "POST" });
      if (res.ok) load();
    } finally {
      setBusyId(null);
    }
  }

  async function rotate(id: string) {
    setBusyId(id);
    try {
      const formData = new FormData();
      formData.append("rotateDegrees", "90");
      const res = await fetch(`/api/my-profile/photos/${id}`, { method: "PATCH", body: formData });
      if (res.ok) {
        show("Photo rotated.", "success");
        load();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/my-profile/photos/${id}`, { method: "DELETE" });
      if (res.ok) load();
    } finally {
      setBusyId(null);
    }
  }

  if (!items) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Photos</h1>
        <p className="mt-1 text-sm text-muted">Up to {MAX_PHOTOS} photos. Never publicly displayed — only visible to authorized staff for matchmaking.</p>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((p) => (
            <Card key={p.id}>
              <CardContent className="space-y-2 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/my-profile/photo/${p.id}`} alt="Profile" className="aspect-square w-full rounded-lg object-cover" />
                {p.isPrimary && <Badge variant="success">Primary</Badge>}
                <div className="flex items-center justify-between gap-1">
                  {!p.isPrimary && (
                    <button title="Set as primary" onClick={() => setPrimary(p.id)} disabled={busyId === p.id} className="text-muted hover:text-primary">
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button title="Rotate" onClick={() => rotate(p.id)} disabled={busyId === p.id} className="text-muted hover:text-primary">
                    <RotateCw className="h-4 w-4" />
                  </button>
                  <button title="Delete" onClick={() => remove(p.id)} disabled={busyId === p.id} className="text-muted hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {items.length < MAX_PHOTOS && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <p className="text-sm font-medium flex items-center gap-1.5"><Plus className="h-4 w-4" /> Add a Photo</p>
            <PhotoUpload onChange={setNewFile} />
            <Button onClick={upload} disabled={!newFile || uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Upload
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
