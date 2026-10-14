"use client";

import { useActionState, useState } from "react";
import { deleteAccount } from "@/app/actions/account";
import { DELETE_CONFIRMATION } from "@/app/actions/account-state";

export function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(deleteAccount, { error: null });

  if (!open) {
    return (
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Delete my account…
      </button>
    );
  }

  return (
    <form action={formAction} aria-describedby="delete-warning">
      <p id="delete-warning" className="alert alert-error">
        This permanently deletes your account, signs out every device and stops all playback. An active subscription
        is not refunded automatically.
      </p>
      {state.error ? (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="confirmation">
          Type <strong>{DELETE_CONFIRMATION}</strong> to confirm
        </label>
        <input id="confirmation" name="confirmation" autoComplete="off" required />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? "Deleting…" : "Permanently delete account"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
