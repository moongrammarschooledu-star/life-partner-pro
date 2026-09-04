"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onCancel,
  confirmDisabled,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  // Optional embedded fields shown between the description and the buttons
  // — e.g. Reject Proposal's reason select + note, which must be captured
  // before the destructive action is confirmed.
  children?: React.ReactNode;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm text-muted mb-4">{description}</p>
      {children && <div className="mb-6 space-y-3">{children}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={confirmDisabled}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
