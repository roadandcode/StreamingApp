"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

const LINKS = [
  { href: "/content", label: "Content" },
  { href: "/users", label: "Users" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={styles.nav}>
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
