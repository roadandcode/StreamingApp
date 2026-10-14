"use client";

import { useActionState, type FormEvent } from "react";
import type { SimpleActionState } from "@/lib/action-state";

interface ConfirmActionButtonProps {
  action: (previous: SimpleActionState, formData: FormData) => Promise<SimpleActionState>;
  label: string;
  pendingLabel: string;
  /** Shown in the browser's confirmation dialog before anything is sent. */
  confirmMessage: string;
  variant?: "danger" | "default";
  size?: "small" | "normal";
}

/** A form button for a destructive server action, guarded by a confirmation dialog. */
export function ConfirmActionButton({
  action,
  label,
  pendingLabel,
  confirmMessage,
  variant = "danger",
  size = "normal",
}: ConfirmActionButtonProps) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });

  function confirmBeforeSubmit(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  }

  const className = [
    "btn",
    variant === "danger" ? "btn-danger" : "",
    size === "small" ? "btn-small" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form action={formAction} onSubmit={confirmBeforeSubmit} style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
      <button type="submit" className={className} disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state.status === "error" ? (
        <span className="field-error" role="alert">
          {state.message}
        </span>
      ) : null}
      {state.status === "done" ? (
        <span className="hint" role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
