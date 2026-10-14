/**
 * Server-side configuration. Read lazily and validated once; `instrumentation.ts` calls
 * `getServerEnv()` when the server boots so a bad configuration fails at startup instead of on
 * the first request.
 *
 * Never import this from a client component: it holds the session encryption key.
 */

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const MIN_SECRET_LENGTH = 32;

export interface ServerEnv {
  /** Origin (plus optional path prefix) of the API, without a trailing slash. */
  apiBaseUrl: string;
  sessionCookieSecret: string;
  isProduction: boolean;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid admin-web configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const problems: string[] = [];

  const rawApiBaseUrl = source.API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  let apiBaseUrl = rawApiBaseUrl;
  try {
    const url = new URL(rawApiBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      problems.push("API_BASE_URL must use http or https.");
    }
    if (url.search || url.hash) {
      problems.push("API_BASE_URL must not contain a query string or fragment.");
    }
    apiBaseUrl = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    problems.push(`API_BASE_URL is not a valid absolute URL (got "${rawApiBaseUrl}").`);
  }

  const sessionCookieSecret = source.SESSION_COOKIE_SECRET ?? "";
  if (sessionCookieSecret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `SESSION_COOKIE_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters long.`,
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    apiBaseUrl,
    sessionCookieSecret,
    isProduction: source.NODE_ENV === "production",
  };
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
