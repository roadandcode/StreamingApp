"use client";

import dynamic from "next/dynamic";
import type { WebPlayerProps } from "./WebPlayer";
import styles from "./WebPlayer.module.css";

/** Loads the player (and Shaka Player) only in the browser; it never runs on the server. */
const WebPlayer = dynamic(() => import("./WebPlayer"), {
  ssr: false,
  loading: () => (
    <div className={styles.shell}>
      <div className={styles.container} data-testid="player" data-state="loading">
        <div className={styles.overlay} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Loading player…</span>
        </div>
      </div>
    </div>
  ),
});

export function PlayerLoader(props: WebPlayerProps) {
  return <WebPlayer {...props} />;
}
