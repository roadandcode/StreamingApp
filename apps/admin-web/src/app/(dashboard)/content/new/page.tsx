import type { Metadata } from "next";
import Link from "next/link";
import { ContentForm } from "@/components/ContentForm";
import { ErrorPanel } from "@/components/ErrorPanel";
import { getContent } from "@/lib/api/admin";
import { emptyContentValues } from "@/lib/content-form";
import { firstParam, isUuid, loadPageData, type SearchParams } from "@/lib/page-data";
import { createContentAction } from "../actions";

export const metadata: Metadata = { title: "New content" };

export default async function NewContentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const parentId = firstParam(params, "parentId");
  const requestedKind = firstParam(params, "kind");

  if (parentId !== undefined) {
    if (!isUuid(parentId)) {
      return <InvalidParent message="The course link is not valid." />;
    }
    const result = await loadPageData(() => getContent(parentId));
    if (!result.ok) {
      return <ErrorPanel error={result.error} />;
    }
    const parent = result.data;
    if (parent.kind !== "course") {
      return <InvalidParent message="Lessons can only be added to a course." />;
    }

    return (
      <>
        <div className="breadcrumbs">
          <Link href="/content">Content</Link> › <Link href={`/content/${parent.id}`}>{parent.title}</Link> › New lesson
        </div>
        <div className="page-header">
          <div>
            <h1>New lesson</h1>
            <p>The lesson is created as a draft. Upload its video next, then publish it.</p>
          </div>
        </div>
        <div className="card">
          <ContentForm
            key={`lesson:${parent.id}`}
            mode="create"
            action={createContentAction}
            initialValues={emptyContentValues({
              kind: "lesson",
              parentId: parent.id,
              accessTier: parent.accessTier,
              defaultLanguage: parent.defaultLanguage,
              ageRating: parent.ageRating ?? "",
              regions: parent.regions.join(", "),
            })}
            kindOptions={[{ value: "lesson", label: "Lesson" }]}
            parent={{ id: parent.id, title: parent.title }}
            submitLabel="Create lesson"
          />
        </div>
      </>
    );
  }

  const kind = requestedKind === "course" ? "course" : "video";
  return (
    <>
      <div className="breadcrumbs">
        <Link href="/content">Content</Link> › New
      </div>
      <div className="page-header">
        <div>
          <h1>{kind === "course" ? "New course" : "New video"}</h1>
          <p>
            {kind === "course"
              ? "A course groups lessons. Add lessons after creating it."
              : "A standalone video. Upload the video after creating it, then publish."}
          </p>
        </div>
      </div>
      <div className="card">
        <ContentForm
          key={kind}
          mode="create"
          action={createContentAction}
          initialValues={emptyContentValues({ kind })}
          kindOptions={[
            { value: "course", label: "Course" },
            { value: "video", label: "Video" },
          ]}
          submitLabel="Create"
        />
      </div>
    </>
  );
}

function InvalidParent({ message }: { message: string }) {
  return (
    <div className="card" role="alert">
      <h2>Cannot add a lesson here</h2>
      <p>{message}</p>
      <Link href="/content" className="btn">
        Back to content
      </Link>
    </div>
  );
}
