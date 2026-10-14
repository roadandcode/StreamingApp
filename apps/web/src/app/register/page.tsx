import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { safeNextPath } from "@/lib/navigation";
import { readSession } from "@/lib/session/server";

export const metadata: Metadata = { title: "Create your account", robots: { index: false, follow: false } };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : undefined);
  if (await readSession()) redirect(next);

  return (
    <AuthShell title="Create your free account" subtitle="Watch free lessons right away. Subscribe whenever you are ready.">
      <AuthForm mode="register" next={next} />
    </AuthShell>
  );
}
