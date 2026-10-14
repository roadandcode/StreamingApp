/**
 * Server-side configuration, read from the environment and validated once.
 *
 * Only server code may import this module. Values the browser needs (fake billing, DRM policy,
 * resolution cap) are passed down as props, so the runtime environment is the single source of
 * truth even for `NEXT_PUBLIC_*` names.
 */

export interface ServerConfig {
  /** Base URL of the API, without a trailing slash. */
  apiBaseUrl: string;
  /** Key for the encrypted session cookie (at least 32 characters). */
  sessionCookieSecret: string;
  /** Show the development "Simulate purchase" button (the API must run with BILLING_MODE=fake). */
  fakeBilling: boolean;
  /** Refuse playback authorizations without DRM (`drm: null`). */
  requireDrm: boolean;
  /** Highest video rendition the web player may select. */
  maxVideoHeight: number;
  /** Public origin of this website, used for canonical URLs, the sitemap and origin checks. */
  siteUrl: string;
  /** Origins that serve manifests, segments, licences and thumbnails (Content-Security-Policy). */
  mediaOrigins: string[];
  /** Name of a CDN-set country header to forward to the API (optional). */
  trustedCountryHeader: string | null;
  isProduction: boolean;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid web configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;

function parseBool(name: string, raw: string | undefined, problems: string[]): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  problems.push(`${name} must be "true" or "false" (got "${raw}")`);
  return false;
}

function parseHttpUrl(name: string, raw: string | undefined, fallback: string, problems: string[]): string {
  const value = raw?.trim() || fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      problems.push(`${name} must be an http(s) URL`);
      return fallback;
    }
    return value.replace(/\/+$/, "");
  } catch {
    problems.push(`${name} must be a valid URL (got "${value}")`);
    return fallback;
  }
}

function parseOrigins(name: string, raw: string | undefined, fallback: string[], problems: string[]): string[] {
  if (raw === undefined || raw.trim() === "") return fallback;
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
      origins.push(url.origin);
    } catch {
      problems.push(`${name} entries must be http(s) origins (got "${value}")`);
    }
  }
  return origins;
}

/** Pure parser so it can be unit-tested; throws {@link ConfigError} listing every problem. */
export function parseConfig(env: Env): ServerConfig {
  const problems: string[] = [];

  const apiBaseUrl = parseHttpUrl("API_BASE_URL", env.API_BASE_URL, "http://localhost:3000", problems);

  const sessionCookieSecret = env.SESSION_COOKIE_SECRET ?? "";
  if (sessionCookieSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`SESSION_COOKIE_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long`);
  }

  const fakeBilling = parseBool("NEXT_PUBLIC_FAKE_BILLING", env.NEXT_PUBLIC_FAKE_BILLING, problems);
  const requireDrm = parseBool("REQUIRE_DRM", env.REQUIRE_DRM, problems);

  let maxVideoHeight = 720;
  if (env.WEB_MAX_VIDEO_HEIGHT !== undefined && env.WEB_MAX_VIDEO_HEIGHT.trim() !== "") {
    const parsed = Number(env.WEB_MAX_VIDEO_HEIGHT);
    if (!Number.isInteger(parsed) || parsed < 144 || parsed > 4320) {
      problems.push("WEB_MAX_VIDEO_HEIGHT must be an integer between 144 and 4320");
    } else {
      maxVideoHeight = parsed;
    }
  }

  const siteUrl = parseHttpUrl("NEXT_PUBLIC_SITE_URL", env.NEXT_PUBLIC_SITE_URL, "http://localhost:3002", problems);

  let apiOrigin = "http://localhost:3000";
  try {
    apiOrigin = new URL(apiBaseUrl).origin;
  } catch {
    // already reported above
  }
  const mediaOrigins = parseOrigins("MEDIA_ORIGINS", env.MEDIA_ORIGINS, [apiOrigin], problems);

  const header = env.TRUSTED_COUNTRY_HEADER?.trim().toLowerCase() || null;
  if (header !== null && !/^[a-z0-9-]+$/.test(header)) {
    problems.push("TRUSTED_COUNTRY_HEADER must be a plain header name");
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    apiBaseUrl,
    sessionCookieSecret,
    fakeBilling,
    requireDrm,
    maxVideoHeight,
    siteUrl,
    mediaOrigins,
    trustedCountryHeader: header,
    isProduction: env.NODE_ENV === "production",
  };
}

let cached: ServerConfig | undefined;

/** The validated configuration of this process. Throws (and keeps throwing) when it is invalid. */
export function getConfig(): ServerConfig {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}
