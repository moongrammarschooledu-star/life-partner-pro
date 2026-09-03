import { PhotoUpload } from "@/components/ui/photo-upload";

export function StepPhoto({ onChange, error }: { onChange: (file: File | null) => void; error?: string }) {
  return (
    <div className="flex justify-center py-6">
      <PhotoUpload onChange={onChange} error={error} />
    </div>
  );
}
