"use client";

import { useRef, useState } from "react";
import { ImagePlus, X, Loader2, RotateCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_DIMENSION = 200;

async function drawToCanvas(bitmap: ImageBitmap, rotationDeg: number, maxDim: number): Promise<HTMLCanvasElement> {
  const swap = rotationDeg % 180 !== 0;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = swap ? drawH : drawW;
  canvas.height = swap ? drawW : drawH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  return canvas;
}

// A crude, non-biometric sharpness heuristic: downsample to grayscale and
// measure the variance of pixel-to-pixel differences. Blurry/flat images
// have low variance. This looks only at pixel contrast — never at facial
// features, age, gender, ethnicity, or any other attribute of the subject.
function estimateSharpness(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 1;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const step = 4 * 3; // sample every 3rd pixel for speed
  for (let i = 0; i < data.length - step; i += step) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const nextGray = (data[i + step] + data[i + step + 1] + data[i + step + 2]) / 3;
    const diff = Math.abs(gray - nextGray);
    sum += diff;
    sumSq += diff * diff;
    count++;
  }
  if (count === 0) return 1;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance;
}

function canvasToJpegFile(canvas: HTMLCanvasElement, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(new File([blob ?? new Blob()], "profile-photo.jpg", { type: "image/jpeg" })),
      "image/jpeg",
      quality
    );
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
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [quality, setQuality] = useState<"good" | "poor" | null>(null);

  async function render(rotationDeg: number) {
    if (!bitmapRef.current) return;
    const canvas = await drawToCanvas(bitmapRef.current, rotationDeg, 800);
    const sharpness = estimateSharpness(canvas);
    const tooSmall = bitmapRef.current.width < MIN_DIMENSION || bitmapRef.current.height < MIN_DIMENSION;
    setQuality(tooSmall || sharpness < 15 ? "poor" : "good");
    const file = await canvasToJpegFile(canvas);
    setPreview(URL.createObjectURL(file));
    onChange(file);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      onChange(null);
      return;
    }
    setProcessing(true);
    try {
      const bitmap = await createImageBitmap(file);
      bitmapRef.current = bitmap;
      setRotation(0);
      await render(0);
    } finally {
      setProcessing(false);
    }
  }

  async function rotate() {
    const next = (rotation + 90) % 360;
    setRotation(next);
    setProcessing(true);
    try {
      await render(next);
    } finally {
      setProcessing(false);
    }
  }

  function clear() {
    setPreview(null);
    setQuality(null);
    bitmapRef.current = null;
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted max-w-sm">
        <span className="mt-0.5 shrink-0">🔒</span>
        <div>
          <p className="font-medium text-foreground">Your Photo Is Private</p>
          <p className="text-xs">
            Your profile photo will not be publicly displayed. It will only be available to authorized Life Partner Pro
            administrators for matchmaking purposes.
          </p>
        </div>
      </div>

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
        capture="user"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => inputRef.current?.click()} className="text-sm font-medium text-primary hover:underline">
          {preview ? "Replace photo" : "Upload photo"}
        </button>
        {preview && (
          <button type="button" onClick={rotate} className="flex items-center gap-1 text-sm text-primary hover:underline">
            <RotateCw className="h-3.5 w-3.5" /> Rotate
          </button>
        )}
        {preview && (
          <button type="button" onClick={clear} className="flex items-center gap-1 text-sm text-danger hover:underline">
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
      {quality && (
        <p className={cn("flex items-center gap-1.5 text-xs", quality === "good" ? "text-success" : "text-warning")}>
          {quality === "good" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {quality === "good" ? "Photo looks good." : "Please upload a clearer photo."}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-muted text-center max-w-xs">JPEG, PNG or WebP.</p>
    </div>
  );
}
