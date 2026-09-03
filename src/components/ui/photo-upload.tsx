"use client";

import { useRef, useState } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

async function compressImage(file: File, maxDim = 800, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality);
  });
}

export function PhotoUpload({
  onChange,
  error,
}: {
  onChange: (file: File | null) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      onChange(null);
      return;
    }
    setProcessing(true);
    try {
      const compressed = await compressImage(file);
      const compressedFile = new File([compressed], "profile-photo.jpg", { type: "image/jpeg" });
      setPreview(URL.createObjectURL(compressedFile));
      onChange(compressedFile);
    } finally {
      setProcessing(false);
    }
  }

  function clear() {
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          "flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-surface-muted",
          error && "border-danger"
        )}
      >
        {processing ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Profile preview" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-8 w-8 text-muted" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-sm font-medium text-primary hover:underline"
        >
          {preview ? "Replace photo" : "Upload photo"}
        </button>
        {preview && (
          <button type="button" onClick={clear} className="flex items-center gap-1 text-sm text-danger hover:underline">
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-muted text-center max-w-xs">
        JPEG, PNG or WebP. Your photo is stored securely and is only ever visible to authorized administrators.
      </p>
    </div>
  );
}
