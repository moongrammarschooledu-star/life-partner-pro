import { PhotoUpload } from "@/components/ui/photo-upload";
import { useRegistrationLocale } from "@/components/registration/locale-context";

export function StepPhoto({ onChange, error }: { onChange: (file: File | null) => void; error?: string }) {
  const { t } = useRegistrationLocale();
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <p className="text-sm text-muted text-center">{t("step7Subtitle")}</p>
      <PhotoUpload onChange={onChange} error={error} />
    </div>
  );
}
