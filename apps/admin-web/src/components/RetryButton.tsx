"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RetryButton({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          router.refresh();
          onRetry?.();
        })
      }
    >
      {pending ? "Retrying…" : "Try again"}
    </button>
  );
}
