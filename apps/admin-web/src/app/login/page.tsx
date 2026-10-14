import type { Metadata } from "next";
import { firstParam, type SearchParams } from "@/lib/page-data";
import { safeNextPath } from "@/lib/session/server";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  expired: "Your session has expired. Please sign in again.",
  "signed-out": "You have been signed out.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params, "next"));
  const reason = firstParam(params, "reason");
  const notice = reason ? (NOTICES[reason] ?? null) : null;

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brand}>StreamingApp</p>
        <h1 className={styles.title}>Admin sign in</h1>
        <LoginForm next={next} notice={notice} />
      </div>
    </main>
  );
}
