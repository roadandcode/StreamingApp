"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionFailure, type ActionResult } from "@/lib/action-result";
import {
  createContent,
  createUploadSession,
  getContent,
  publishContent,
  unpublishContent,
  updateContent,
} from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import type { AdminContent, UploadSession } from "@/lib/api/types";
import {
  buildCreateRequest,
  buildUpdateRequest,
  fieldFromApiMessage,
  hasErrors,
  readContentValues,
  type ContentFormState,
  type ContentFormValues,
} from "@/lib/content-form";
import { isUuid } from "@/lib/page-data";
import { requireAdminSession } from "@/lib/session/server";

function apiErrorState(error: unknown, values: ContentFormValues): ContentFormState {
  const failure = actionFailure(error);
  const state: ContentFormState = { status: "error", values, fieldErrors: {}, formError: failure.error };
  if (isApiError(error) && error.code === "VALIDATION_FAILED") {
    const field = fieldFromApiMessage(error.message);
    if (field) {
      state.fieldErrors[field] = error.message;
    }
  }
  return state;
}

export async function createContentAction(
  _previous: ContentFormState,
  formData: FormData,
): Promise<ContentFormState> {
  await requireAdminSession();
  const values = readContentValues(formData);
  const { body, errors } = buildCreateRequest(values);
  if (!body || hasErrors(errors)) {
    return { status: "error", values, fieldErrors: errors, formError: "Fix the highlighted fields." };
  }

  let created: AdminContent;
  try {
    created = await createContent(body);
  } catch (error) {
    return apiErrorState(error, values);
  }

  revalidatePath("/content");
  if (created.parentId) {
    revalidatePath(`/content/${created.parentId}`);
  }
  redirect(`/content/${created.id}`);
}

export async function updateContentAction(
  contentId: string,
  _previous: ContentFormState,
  formData: FormData,
): Promise<ContentFormState> {
  await requireAdminSession();
  const values = readContentValues(formData);
  if (!isUuid(contentId)) {
    return { status: "error", values, fieldErrors: {}, formError: "Unknown content item." };
  }

  try {
    const current = await getContent(contentId, "action");
    const { body, errors } = buildUpdateRequest(values, current);
    if (!body || hasErrors(errors)) {
      return { status: "error", values, fieldErrors: errors, formError: "Fix the highlighted fields." };
    }
    if (Object.keys(body).length > 0) {
      await updateContent(contentId, body);
    }
  } catch (error) {
    return apiErrorState(error, values);
  }

  revalidatePath(`/content/${contentId}`);
  revalidatePath("/content");
  return { status: "saved", values, fieldErrors: {} };
}

export type PublishState = { status: "idle" } | { status: "error"; message: string; code?: string };

async function changePublication(
  contentId: string,
  change: (id: string) => Promise<AdminContent>,
): Promise<PublishState> {
  await requireAdminSession();
  if (!isUuid(contentId)) {
    return { status: "error", message: "Unknown content item." };
  }
  try {
    const updated = await change(contentId);
    revalidatePath(`/content/${contentId}`);
    revalidatePath("/content");
    if (updated.parentId) {
      revalidatePath(`/content/${updated.parentId}`);
    }
    return { status: "idle" };
  } catch (error) {
    const failure = actionFailure(error);
    if (failure.code === "ASSET_NOT_READY") {
      // The page was showing a stale asset state; refresh it so the button reflects reality.
      revalidatePath(`/content/${contentId}`);
    }
    return { status: "error", message: failure.error, code: failure.code };
  }
}

export async function publishAction(contentId: string, _previous: PublishState, _formData: FormData): Promise<PublishState> {
  return changePublication(contentId, publishContent);
}

export async function unpublishAction(
  contentId: string,
  _previous: PublishState,
  _formData: FormData,
): Promise<PublishState> {
  return changePublication(contentId, unpublishContent);
}

/**
 * Asks the API for a signed upload URL. The browser then sends the file straight to that URL;
 * the URL carries its own signature, so the admin's tokens never leave the server.
 */
export async function startUploadAction(contentId: string): Promise<ActionResult<UploadSession>> {
  await requireAdminSession();
  if (!isUuid(contentId)) {
    return { ok: false, error: "Unknown content item." };
  }
  try {
    const session = await createUploadSession(contentId);
    return { ok: true, data: session };
  } catch (error) {
    return actionFailure(error);
  }
}
