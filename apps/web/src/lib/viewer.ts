import "server-only";
import { cache } from "react";
import { publicGet, renderApiFetch } from "@/lib/api/server";
import type { ContentDetail, ContentSummary, Paginated, Plan, SubscriptionView } from "@/lib/api/types";
import { readSession } from "@/lib/session/server";

/** Data loaders for server components. `cache` de-duplicates them within one render. */

export const getCatalog = cache(async (): Promise<ContentSummary[]> => {
  const page = await publicGet<Paginated<ContentSummary>>("/v1/catalog?page=1&pageSize=100");
  return page.items;
});

export const getContent = cache(async (id: string): Promise<ContentDetail> => {
  return publicGet<ContentDetail>(`/v1/content/${encodeURIComponent(id)}`);
});

export const getPlans = cache(async (): Promise<Plan[]> => publicGet<Plan[]>("/v1/plans", 300));

export interface ViewerAccess {
  signedIn: boolean;
  email: string | null;
  subscription: SubscriptionView | null;
  /** Hint only, for lock icons. The API authorizes every playback. */
  hasAccess: boolean;
}

export const getViewerAccess = cache(async (): Promise<ViewerAccess> => {
  const session = await readSession();
  if (!session) return { signedIn: false, email: null, subscription: null, hasAccess: false };
  try {
    const subscription = await renderApiFetch<SubscriptionView>("/v1/me/subscription");
    return { signedIn: true, email: session.user.email, subscription, hasAccess: subscription.hasAccess };
  } catch {
    return { signedIn: true, email: session.user.email, subscription: null, hasAccess: false };
  }
});
