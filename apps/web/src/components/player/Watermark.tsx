"use client";

import { useEffect, useRef } from "react";
import styles from "./WebPlayer.module.css";

const MOVE_EVERY_MS = 12_000;

/**
 * A faint watermark with the viewer's email that drifts to a new spot every few seconds.
 * Browsers cannot block screen capture, so this is a deterrent that makes leaks attributable.
 * Positions are set through the CSSOM (not inline style attributes), which the CSP allows.
 */
export function Watermark({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const move = () => {
      element.style.setProperty("--wm-x", `${5 + Math.random() * 60}%`);
      element.style.setProperty("--wm-y", `${8 + Math.random() * 74}%`);
    };
    move();
    const timer = setInterval(move, MOVE_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div ref={ref} className={styles.watermark} aria-hidden="true" data-testid="watermark">
      {text}
    </div>
  );
}
