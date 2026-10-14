/**
 * Content-Security-Policy for every page. Scripts need a per-request nonce (set by `proxy.ts`);
 * `'strict-dynamic'` lets our own nonce'd scripts load Razorpay Checkout and the player chunks.
 */

/** Origins Razorpay Checkout needs: its script, its payment iframe and its API calls. */
const RAZORPAY = {
  script: ["https://checkout.razorpay.com"],
  frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
  connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com"],
  img: ["https://cdn.razorpay.com"],
};

export interface CspOptions {
  nonce: string;
  /** Manifest, segment, licence and thumbnail origins from configuration. */
  mediaOrigins: readonly string[];
  /** Development needs `'unsafe-eval'` (React debugging) and websocket HMR. */
  isDevelopment: boolean;
  /** Add `upgrade-insecure-requests` (production behind HTTPS). */
  upgradeInsecureRequests: boolean;
}

export function buildCsp(options: CspOptions): string {
  const media = [...new Set(options.mediaOrigins)];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${options.nonce}'`,
      "'strict-dynamic'",
      // Fallback for browsers without 'strict-dynamic'; ignored by those that support it.
      ...RAZORPAY.script,
      ...(options.isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    // Inline styles: React style attributes and Razorpay Checkout. Scripts stay nonce-only.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...media, ...RAZORPAY.img],
    "font-src": ["'self'", "data:"],
    // The player fetches manifests, segments and licences; MSE plays them from blob: URLs.
    "connect-src": [
      "'self'",
      ...media,
      ...RAZORPAY.connect,
      ...(options.isDevelopment ? ["ws:", "wss:"] : []),
    ],
    "media-src": ["'self'", "blob:", ...media],
    "worker-src": ["'self'", "blob:"],
    "frame-src": RAZORPAY.frame,
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (options.upgradeInsecureRequests) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headers sent with every response (set in next.config.ts). */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "usb=()",
      "picture-in-picture=()",
      "encrypted-media=(self)",
      "fullscreen=(self)",
      'payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")',
    ].join(", "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];
