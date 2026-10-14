import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { safeNextPath } from "@/lib/navigation";
import { readSession } from "@/lib/session/server";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : undefined);
  if (await readSession()) redirect(next);

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue watching.">
      <AuthForm mode="login" next={next} />
    </AuthShell>
  );
}
