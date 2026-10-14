import type { MetadataRoute } from "next";
import { getConfig } from "@/lib/config";
import { getCatalog, getContent } from "@/lib/viewer";

// Built per request (and cached through the data cache) so it never calls the API at build time.
export const dynamic = "force-dynamic";

const MAX_COURSES_EXPANDED = 200;

/** Public, indexable pages only: the landing page and published content (courses, lessons, videos). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { siteUrl } = getConfig();
  const entries: MetadataRoute.Sitemap = [{ url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 }];

  let items;
  try {
    items = await getCatalog();
  } catch {
    return entries;
  }

  const seen = new Set<string>();
  const add = (id: string, priority: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({ url: `${siteUrl}/content/${id}`, changeFrequency: "weekly", priority });
  };

  for (const item of items) add(item.id, item.kind === "course" ? 0.8 : 0.7);

  const courses = items.filter((item) => item.kind === "course").slice(0, MAX_COURSES_EXPANDED);
  const details = await Promise.allSettled(courses.map((course) => getContent(course.id)));
  for (const detail of details) {
    if (detail.status === "fulfilled") {
      for (const lesson of detail.value.children) add(lesson.id, 0.5);
    }
  }
  return entries;
}
