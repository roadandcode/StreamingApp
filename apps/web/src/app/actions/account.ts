"use server";

import { redirect } from "next/navigation";
import { asApiError, userMessage } from "@/lib/api/errors";
import { ApiSession } from "@/lib/api/server";
import { loginPath } from "@/lib/navigation";
import { DELETE_CONFIRMATION, type DeleteAccountState } from "./account-state";

/** `DELETE /v1/me` after the viewer typed the confirmation word. Signs this browser out. */
export async function deleteAccount(_previous: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  if (String(formData.get("confirmation") ?? "").trim() !== DELETE_CONFIRMATION) {
    return { error: `Type ${DELETE_CONFIRMATION} to confirm.` };
  }
  const api = await ApiSession.load();
  if (!api.data) redirect(loginPath("/account"));
  try {
    await api.fetch("/v1/me", { method: "DELETE" });
  } catch (error) {
    return { error: userMessage(asApiError(error).toBody()) };
  }
  await api.clear();
  redirect("/?notice=account-deleted");
}
