// In-memory stand-in for the StreamingApp API, faithful to docs/architecture/api-contract.md for the
// endpoints the viewer website uses. Development and tests only; it is never deployed.
//
//   node e2e/mock-api.mjs            # listens on MOCK_API_PORT (default 3200)
//
// Environment: MOCK_API_PORT, MOCK_PUBLIC_URL, MOCK_CORS_ORIGINS, MOCK_ACCESS_TOKEN_TTL_SECONDS,
// MOCK_HEARTBEAT_INTERVAL_SECONDS, MOCK_MAX_DEVICES, MOCK_MAX_CONCURRENT_STREAMS, MOCK_LOG=1.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.MOCK_API_PORT ?? 3200);
const PUBLIC_URL = (process.env.MOCK_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const CORS_ORIGINS = (process.env.MOCK_CORS_ORIGINS ?? "http://localhost:3001,http://localhost:3002").split(",");
const ACCESS_TTL = Number(process.env.MOCK_ACCESS_TOKEN_TTL_SECONDS ?? 900);
const REFRESH_TTL_DAYS = 30;
const HEARTBEAT_INTERVAL = Number(process.env.MOCK_HEARTBEAT_INTERVAL_SECONDS ?? 30);
const PLAYBACK_AUTH_TTL = 300;
const MAX_DEVICES = Number(process.env.MOCK_MAX_DEVICES ?? 3);
const MAX_STREAMS = Number(process.env.MOCK_MAX_CONCURRENT_STREAMS ?? 2);
const LOG = process.env.MOCK_LOG === "1";
const MEDIA_SECRET = randomBytes(32);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hls");

// ---------------------------------------------------------------------------------------------
// Seed data (fixed ids so tests and humans can link to them)

const thumb = (name) => `${PUBLIC_URL}/static/thumbs/${name}.svg`;

const CONTENT = [
  {
    id: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a01",
    kind: "course",
    title: "Foundations of Hindustani Classical Vocals",
    description:
      "Learn to sing with confidence: sur, breath, alankars and your first raag, taught step by step by a working vocalist.",
    accessTier: "premium",
    thumbnailUrl: thumb("vocals"),
    defaultLanguage: "hi",
    ageRating: "U",
    durationSeconds: 5400,
    parentId: null,
    subtitles: [
      { language: "en", label: "English" },
      { language: "hi", label: "हिन्दी" },
    ],
    playable: false,
    assetId: null,
  },
  {
    id: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a02",
    kind: "lesson",
    title: "Welcome and your first raag",
    description: "Meet your teacher and sing the opening phrases of Raag Yaman.",
    accessTier: "free",
    thumbnailUrl: null,
    defaultLanguage: "hi",
    ageRating: "U",
    durationSeconds: 720,
    parentId: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a01",
    subtitles: [],
    playable: true,
    assetId: "asset-vocals-1",
  },
  {
    id: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a03",
    kind: "lesson",
    title: "Breath, posture and sur",
    description: "Build the breath support and posture that keep you in tune.",
    accessTier: "premium",
    thumbnailUrl: null,
    defaultLanguage: "hi",
    ageRating: "U",
    durationSeconds: 1260,
    parentId: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a01",
    subtitles: [],
    playable: true,
    assetId: "asset-vocals-2",
  },
  {
    id: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a04",
    kind: "lesson",
    title: "Alankars for daily practice",
    description: "A fifteen-minute daily routine of alankars.",
    accessTier: "premium",
    thumbnailUrl: null,
    defaultLanguage: "hi",
    ageRating: "U",
    durationSeconds: 980,
    parentId: "0b5c2a38-7f43-4c55-9a62-1f0c7d3e9a01",
    subtitles: [],
    playable: true,
    assetId: "asset-vocals-3",
  },
  {
    id: "4e7d9b1c-2a3f-4b8e-8c6d-5f1a2b3c4d01",
    kind: "course",
    title: "Startup Finance for First-time Founders",
    description: "Cap tables, runway and GST basics for Indian startups, without the jargon.",
    accessTier: "premium",
    thumbnailUrl: null,
    defaultLanguage: "en",
    ageRating: null,
    durationSeconds: 3600,
    parentId: null,
    subtitles: [],
    playable: false,
    assetId: null,
  },
  {
    id: "4e7d9b1c-2a3f-4b8e-8c6d-5f1a2b3c4d02",
    kind: "lesson",
    title: "Reading your first cap table",
    description: "Founders, ESOPs and investors on one page.",
    accessTier: "free",
    thumbnailUrl: null,
    defaultLanguage: "en",
    ageRating: null,
    durationSeconds: 900,
    parentId: "4e7d9b1c-2a3f-4b8e-8c6d-5f1a2b3c4d01",
    subtitles: [],
    playable: true,
    assetId: "asset-finance-1",
  },
  {
    id: "4e7d9b1c-2a3f-4b8e-8c6d-5f1a2b3c4d03",
    kind: "lesson",
    title: "Runway and burn",
    description: "How long your money lasts, and how to make it last longer.",
    accessTier: "premium",
    thumbnailUrl: null,
    defaultLanguage: "en",
    ageRating: null,
    durationSeconds: 1100,
    parentId: "4e7d9b1c-2a3f-4b8e-8c6d-5f1a2b3c4d01",
    subtitles: [],
    playable: true,
    assetId: "asset-finance-2",
  },
  {
    id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c01",
    kind: "video",
    title: "Monsoon Kitchen: Five Regional Curries",
    description: "Five curries from five states, cooked in one rainy afternoon.",
    accessTier: "free",
    thumbnailUrl: thumb("kitchen"),
    defaultLanguage: "en",
    ageRating: "U",
    durationSeconds: 1500,
    parentId: null,
    subtitles: [{ language: "en", label: "English" }],
    playable: true,
    assetId: "asset-kitchen",
  },
  {
    id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c02",
    kind: "video",
    title: "Behind the Scenes: Making an Original",
    description: "From script to screen: how our first original series was made.",
    accessTier: "premium",
    thumbnailUrl: null,
    defaultLanguage: "en",
    ageRating: "UA 13+",
    durationSeconds: 2100,
    parentId: null,
    subtitles: [],
    playable: true,
    assetId: "asset-bts",
  },
];

const PLANS = [
  {
    code: "premium_monthly",
    name: "Premium Monthly",
    billingPeriod: "P1M",
    accessTier: "premium",
    storeProducts: [
      { provider: "google", productId: "premium_monthly" },
      { provider: "fake", productId: "fake_premium_monthly" },
    ],
  },
  {
    code: "premium_yearly",
    name: "Premium Yearly",
    billingPeriod: "P1Y",
    accessTier: "premium",
    storeProducts: [
      { provider: "google", productId: "premium_yearly" },
      { provider: "fake", productId: "fake_premium_yearly" },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// State

const users = new Map(); // id -> user (+ passwordHash)
const usersByEmail = new Map(); // email -> id
const accessTokens = new Map(); // token -> { userId, familyId, expiresAt }
const refreshTokens = new Map(); // token -> { userId, familyId, expiresAt, used }
const revokedFamilies = new Set();
const subscriptions = new Map(); // userId -> subscription
const fakeTransactions = new Map(); // originalTransactionId -> userId
const devices = new Map(); // id -> device (+ userId, removedByUser, blocked)
const sessions = new Map(); // id -> playback session

// ---------------------------------------------------------------------------------------------
// Helpers

class HttpError extends Error {
  constructor(statusCode, code, message, errors) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }
}

const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validation(errors) {
  return new HttpError(400, "VALIDATION_FAILED", "Validation failed", errors);
}

/** Rejects unknown fields and checks each known one, like the API's strict validation. */
function validate(body, schema) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validation([{ field: "body", message: "body must be a JSON object" }]);
  }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!(key in schema)) errors.push({ field: key, message: `property ${key} should not exist` });
  }
  for (const [key, check] of Object.entries(schema)) {
    const message = check(body[key]);
    if (message) errors.push({ field: key, message });
  }
  if (errors.length > 0) throw validation(errors);
  return body;
}

const optional = (check) => (value) => (value === undefined ? null : check(value));
const isString = (min = 1, max = 500) => (value) =>
  typeof value === "string" && value.length >= min && value.length <= max ? null : `must be a string of ${min}-${max} characters`;

function userView(user) {
  const { id, email, displayName, role, accountStatus, createdAt } = user;
  return { id, email, displayName, role, accountStatus, createdAt };
}

function issueTokens(userId, familyId = randomUUID()) {
  const accessToken = randomBytes(24).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");
  const accessExpires = now() + ACCESS_TTL * 1000;
  const refreshExpires = now() + REFRESH_TTL_DAYS * 86400 * 1000;
  accessTokens.set(accessToken, { userId, familyId, expiresAt: accessExpires });
  refreshTokens.set(refreshToken, { userId, familyId, expiresAt: refreshExpires, used: false });
  return {
    accessToken,
    accessTokenExpiresAt: iso(accessExpires),
    refreshToken,
    refreshTokenExpiresAt: iso(refreshExpires),
  };
}

function authenticate(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const entry = token ? accessTokens.get(token) : undefined;
  if (!entry || entry.expiresAt <= now() || revokedFamilies.has(entry.familyId)) {
    throw new HttpError(401, "UNAUTHENTICATED", "Missing, invalid or expired access token");
  }
  const user = users.get(entry.userId);
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Unknown user");
  if (user.accountStatus !== "active") throw new HttpError(403, "ACCOUNT_INACTIVE", "Account is not active");
  return user;
}

function subscriptionView(userId) {
  const sub = subscriptions.get(userId);
  if (!sub) {
    return {
      status: "none",
      hasAccess: false,
      accessTier: null,
      planCode: null,
      provider: null,
      accessUntil: null,
      autoRenewEnabled: false,
    };
  }
  const inPeriod = sub.accessUntil !== null && Date.parse(sub.accessUntil) > now();
  const hasAccess = inPeriod && ["active", "grace_period", "cancelled"].includes(sub.status);
  return {
    status: sub.status,
    hasAccess,
    accessTier: hasAccess ? "premium" : null,
    planCode: sub.planCode,
    provider: sub.provider,
    accessUntil: sub.accessUntil,
    autoRenewEnabled: sub.autoRenewEnabled,
  };
}

function summary(item) {
  const { id, kind, title, description, accessTier, thumbnailUrl, defaultLanguage, ageRating, durationSeconds } = item;
  return { id, kind, title, description, accessTier, thumbnailUrl, defaultLanguage, ageRating, durationSeconds };
}

function detail(item) {
  return {
    ...summary(item),
    parentId: item.parentId,
    children: CONTENT.filter((child) => child.parentId === item.id).map(summary),
    subtitles: item.subtitles,
    playable: item.playable,
  };
}

function deviceView(device) {
  const { id, installationId, platform, name, lastSeenAt, createdAt, revokedAt } = device;
  return { id, installationId, platform, name, lastSeenAt, createdAt, revokedAt };
}

const activeDevices = (userId) => [...devices.values()].filter((d) => d.userId === userId && d.revokedAt === null);

function isStale(session) {
  return now() - session.lastHeartbeatAt > 3 * HEARTBEAT_INTERVAL * 1000;
}

function endSession(session) {
  if (session.endedAt === null) session.endedAt = now();
}

function mediaSignature(assetId, sid, exp) {
  return createHmac("sha256", MEDIA_SECRET).update(`${assetId}|${sid}|${exp}`).digest("hex");
}

/** Checks 1, 2, 4 and 5 of a new session (re-run by heartbeats). */
function entitlementAndDeviceChecks(user, content, deviceId) {
  if (user.accountStatus !== "active") throw new HttpError(403, "ACCOUNT_INACTIVE", "Account is not active");
  if (!content) throw new HttpError(404, "NOT_FOUND", "Content not found");
  if (content.accessTier === "premium" && !subscriptionView(user.id).hasAccess) {
    throw new HttpError(403, "ENTITLEMENT_REQUIRED", "An active subscription is required to watch this content.");
  }
  const device = devices.get(deviceId);
  if (!device || device.userId !== user.id) {
    throw new HttpError(403, "DEVICE_NOT_REGISTERED", "Device is not registered to this account");
  }
  if (device.revokedAt !== null) throw new HttpError(403, "DEVICE_REVOKED", "Device was revoked");
  return device;
}

// ---------------------------------------------------------------------------------------------
// Routes

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/:([a-zA-Z]+)/g, (_m, key) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, regex, keys, handler });
};

route("GET", "/v1/health", () => ({ status: 200, body: { status: "ok", db: "ok" } }));

// Auth and account

route("POST", "/v1/auth/register", ({ body }) => {
  const input = validate(body, {
    email: (v) => (typeof v === "string" && EMAIL_RE.test(v) ? null : "email must be an email"),
    password: (v) => (typeof v === "string" && v.length >= 10 ? null : "password must be at least 10 characters"),
    displayName: optional(isString(1, 80)),
  });
  const email = input.email.trim().toLowerCase();
  if (usersByEmail.has(email)) throw new HttpError(409, "EMAIL_TAKEN", "Email already registered");
  const user = {
    id: randomUUID(),
    email,
    displayName: input.displayName ?? null,
    role: "viewer",
    accountStatus: "active",
    createdAt: iso(now()),
    passwordHash: hash(input.password),
  };
  users.set(user.id, user);
  usersByEmail.set(email, user.id);
  return { status: 201, body: { user: userView(user), tokens: issueTokens(user.id) } };
});

route("POST", "/v1/auth/login", ({ body }) => {
  const input = validate(body, { email: isString(1, 254), password: isString(1, 1000) });
  const user = users.get(usersByEmail.get(input.email.trim().toLowerCase()) ?? "");
  if (!user || user.passwordHash !== hash(input.password)) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Wrong email or password");
  }
  if (user.accountStatus !== "active") throw new HttpError(403, "ACCOUNT_INACTIVE", "Account is not active");
  return { status: 200, body: { user: userView(user), tokens: issueTokens(user.id) } };
});

route("POST", "/v1/auth/refresh", ({ body }) => {
  const input = validate(body, { refreshToken: isString(1, 1000) });
  const entry = refreshTokens.get(input.refreshToken);
  if (!entry || entry.expiresAt <= now() || revokedFamilies.has(entry.familyId)) {
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid");
  }
  if (entry.used) {
    // Reuse of a rotated token: revoke the whole family.
    revokedFamilies.add(entry.familyId);
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token was already used");
  }
  entry.used = true;
  return { status: 200, body: { tokens: issueTokens(entry.userId, entry.familyId) } };
});

route("POST", "/v1/auth/logout", ({ body }) => {
  const input = validate(body, { refreshToken: isString(1, 1000) });
  const entry = refreshTokens.get(input.refreshToken);
  if (entry) revokedFamilies.add(entry.familyId);
  return { status: 204 };
});

route("GET", "/v1/me", ({ req }) => ({ status: 200, body: userView(authenticate(req)) }));

route("DELETE", "/v1/me", ({ req }) => {
  const user = authenticate(req);
  user.accountStatus = "deleted";
  for (const entry of [...accessTokens.values(), ...refreshTokens.values()]) {
    if (entry.userId === user.id) revokedFamilies.add(entry.familyId);
  }
  for (const device of devices.values()) if (device.userId === user.id && !device.revokedAt) device.revokedAt = iso(now());
  for (const session of sessions.values()) if (session.userId === user.id) endSession(session);
  return { status: 204 };
});

// Catalog

route("GET", "/v1/catalog", ({ query }) => {
  const page = Number(query.get("page") ?? 1);
  const pageSize = Number(query.get("pageSize") ?? 20);
  const kind = query.get("kind");
  const language = query.get("language");
  const errors = [];
  if (!Number.isInteger(page) || page < 1) errors.push({ field: "page", message: "page must be >= 1" });
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    errors.push({ field: "pageSize", message: "pageSize must be between 1 and 100" });
  }
  if (kind && !["course", "lesson", "video"].includes(kind)) errors.push({ field: "kind", message: "invalid kind" });
  if (errors.length > 0) throw validation(errors);
  const all = CONTENT.filter(
    (item) => item.parentId === null && (!kind || item.kind === kind) && (!language || item.defaultLanguage === language),
  );
  return {
    status: 200,
    body: { items: all.slice((page - 1) * pageSize, page * pageSize).map(summary), page, pageSize, total: all.length },
  };
});

route("GET", "/v1/content/:id", ({ params }) => {
  const item = CONTENT.find((c) => c.id === params.id);
  if (!item) throw new HttpError(404, "NOT_FOUND", "Content not found");
  return { status: 200, body: detail(item) };
});

// Plans and subscriptions

route("GET", "/v1/plans", () => ({ status: 200, body: PLANS }));

route("GET", "/v1/me/subscription", ({ req }) => ({ status: 200, body: subscriptionView(authenticate(req).id) }));

route("POST", "/v1/purchases/verify", ({ req, body }) => {
  const user = authenticate(req);
  const input = validate(body, {
    provider: (v) => (["apple", "google", "fake"].includes(v) ? null : "provider must be apple, google or fake"),
    productId: isString(1, 200),
    receipt: isString(1, 20000),
  });
  if (input.provider !== "fake") {
    throw new HttpError(503, "PROVIDER_NOT_CONFIGURED", `${input.provider} verification is not configured`);
  }
  const plan = PLANS.find((p) => p.storeProducts.some((s) => s.provider === "fake" && s.productId === input.productId));
  if (!plan) throw new HttpError(400, "INVALID_PURCHASE", "Unknown fake product");
  const owner = fakeTransactions.get(input.receipt);
  if (owner && owner !== user.id) {
    throw new HttpError(409, "PURCHASE_BELONGS_TO_OTHER_ACCOUNT", "Purchase is linked to another account");
  }
  fakeTransactions.set(input.receipt, user.id);
  const days = plan.billingPeriod === "P1Y" ? 365 : 30;
  subscriptions.set(user.id, {
    status: "active",
    planCode: plan.code,
    provider: "fake",
    accessUntil: iso(now() + days * 86400 * 1000),
    autoRenewEnabled: true,
  });
  return { status: 200, body: subscriptionView(user.id) };
});

// Web checkout: like the API without RAZORPAY_* configured, both endpoints fail closed.
route("POST", "/v1/checkout/razorpay/subscriptions", ({ req, body }) => {
  authenticate(req);
  validate(body, { planCode: isString(1, 64) });
  throw new HttpError(503, "PROVIDER_NOT_CONFIGURED", "Razorpay is not configured");
});

route("POST", "/v1/checkout/razorpay/verify", ({ req, body }) => {
  authenticate(req);
  validate(body, {
    razorpaySubscriptionId: isString(1, 128),
    razorpayPaymentId: isString(1, 128),
    razorpaySignature: isString(1, 256),
  });
  throw new HttpError(503, "PROVIDER_NOT_CONFIGURED", "Razorpay is not configured");
});

// Devices

route("GET", "/v1/me/devices", ({ req }) => {
  const user = authenticate(req);
  return { status: 200, body: activeDevices(user.id).map(deviceView) };
});

route("POST", "/v1/me/devices", ({ req, body }) => {
  const user = authenticate(req);
  const input = validate(body, {
    installationId: (v) => (typeof v === "string" && UUID_RE.test(v) ? null : "installationId must be a UUID"),
    platform: (v) => (["android", "ios", "web"].includes(v) ? null : "platform must be android, ios or web"),
    name: isString(1, 100),
  });
  const existing = [...devices.values()].find((d) => d.userId === user.id && d.installationId === input.installationId);
  if (existing?.blocked) throw new HttpError(403, "DEVICE_REVOKED", "This device was blocked");
  if (existing && existing.revokedAt === null) {
    existing.name = input.name;
    existing.lastSeenAt = iso(now());
    return { status: 200, body: deviceView(existing) };
  }
  if (activeDevices(user.id).length >= MAX_DEVICES) {
    throw new HttpError(409, "DEVICE_LIMIT_REACHED", `At most ${MAX_DEVICES} devices`);
  }
  if (existing) {
    // Removed by its owner earlier: re-activate.
    existing.revokedAt = null;
    existing.removedByUser = false;
    existing.name = input.name;
    existing.lastSeenAt = iso(now());
    return { status: 200, body: deviceView(existing) };
  }
  const device = {
    id: randomUUID(),
    installationId: input.installationId,
    platform: input.platform,
    name: input.name,
    lastSeenAt: iso(now()),
    createdAt: iso(now()),
    revokedAt: null,
    userId: user.id,
    removedByUser: false,
    blocked: false,
  };
  devices.set(device.id, device);
  return { status: 201, body: deviceView(device) };
});

route("DELETE", "/v1/me/devices/:id", ({ req, params }) => {
  const user = authenticate(req);
  const device = devices.get(params.id);
  if (!device || device.userId !== user.id || device.revokedAt !== null) {
    throw new HttpError(404, "NOT_FOUND", "Device not found");
  }
  device.revokedAt = iso(now());
  device.removedByUser = true;
  for (const session of sessions.values()) if (session.deviceId === device.id) endSession(session);
  return { status: 204 };
});

// Playback

route("POST", "/v1/playback/sessions", ({ req, body }) => {
  const user = authenticate(req);
  const input = validate(body, {
    contentId: (v) => (typeof v === "string" && UUID_RE.test(v) ? null : "contentId must be a UUID"),
    deviceId: (v) => (typeof v === "string" && UUID_RE.test(v) ? null : "deviceId must be a UUID"),
    supportedDrm: optional((v) =>
      Array.isArray(v) && v.every((s) => ["widevine", "fairplay", "playready"].includes(s))
        ? null
        : "supportedDrm must be a list of widevine, fairplay, playready",
    ),
  });
  const content = CONTENT.find((c) => c.id === input.contentId);
  // Ordered checks (first failure wins): 1 account, 2 content, 3 playable, 4 entitlement, 5 device, 6 streams.
  if (user.accountStatus !== "active") throw new HttpError(403, "ACCOUNT_INACTIVE", "Account is not active");
  if (!content) throw new HttpError(404, "NOT_FOUND", "Content not found");
  if (!content.playable) throw new HttpError(403, "CONTENT_NOT_PLAYABLE", "Content has no ready video");
  const device = entitlementAndDeviceChecks(user, content, input.deviceId);
  const active = [...sessions.values()].filter((s) => s.userId === user.id && s.endedAt === null && !isStale(s));
  if (active.length >= MAX_STREAMS) {
    throw new HttpError(403, "CONCURRENT_STREAM_LIMIT", "Too many active playback sessions");
  }
  device.lastSeenAt = iso(now());
  const session = {
    id: randomUUID(),
    userId: user.id,
    contentId: content.id,
    deviceId: device.id,
    startedAt: now(),
    lastHeartbeatAt: now(),
    endedAt: null,
    positionSeconds: 0,
    heartbeats: 0,
  };
  sessions.set(session.id, session);
  const exp = Math.floor(now() / 1000) + PLAYBACK_AUTH_TTL;
  const sig = mediaSignature(content.assetId, session.id, exp);
  return {
    status: 201,
    body: {
      playbackSessionId: session.id,
      contentId: content.id,
      manifestUrl: `${PUBLIC_URL}/v1/dev/media/${content.assetId}/manifest.m3u8?sid=${session.id}&exp=${exp}&sig=${sig}`,
      expiresAt: iso(now() + PLAYBACK_AUTH_TTL * 1000),
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL,
      drm: null,
    },
  };
});

route("POST", "/v1/playback/sessions/:id/heartbeat", ({ req, params, body }) => {
  const user = authenticate(req);
  const input = validate(body ?? {}, {
    positionSeconds: optional((v) => (typeof v === "number" && v >= 0 ? null : "positionSeconds must be >= 0")),
  });
  const session = sessions.get(params.id);
  if (!session || session.userId !== user.id) throw new HttpError(404, "NOT_FOUND", "Session not found");
  if (session.endedAt === null && isStale(session)) endSession(session);
  if (session.endedAt !== null) throw new HttpError(403, "PLAYBACK_SESSION_ENDED", "Playback session has ended");
  try {
    entitlementAndDeviceChecks(user, CONTENT.find((c) => c.id === session.contentId), session.deviceId);
  } catch (error) {
    endSession(session);
    throw error;
  }
  session.lastHeartbeatAt = now();
  session.heartbeats += 1;
  if (input.positionSeconds !== undefined) session.positionSeconds = input.positionSeconds;
  return { status: 200, body: { expiresAt: iso(now() + PLAYBACK_AUTH_TTL * 1000) } };
});

route("DELETE", "/v1/playback/sessions/:id", ({ req, params }) => {
  const user = authenticate(req);
  const session = sessions.get(params.id);
  if (!session || session.userId !== user.id) throw new HttpError(404, "NOT_FOUND", "Session not found");
  endSession(session);
  return { status: 204 };
});

// Fake media: signed manifest URL -> redirect to the unprotected test stream.
route("GET", "/v1/dev/media/:assetId/manifest.m3u8", ({ params, query }) => {
  const sid = query.get("sid") ?? "";
  const exp = query.get("exp") ?? "";
  const sig = query.get("sig") ?? "";
  const expected = mediaSignature(params.assetId, sid, exp);
  const valid =
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
    Number(exp) * 1000 > now();
  if (!valid) throw new HttpError(401, "INVALID_SIGNATURE", "Invalid or expired media signature");
  return { status: 302, headers: { location: `${PUBLIC_URL}/sample/master.m3u8` } };
});

// ---------------------------------------------------------------------------------------------
// Static media (test stream and thumbnails)

const STATIC_TYPES = { ".m3u8": "application/vnd.apple.mpegurl", ".mp4": "video/mp4", ".m4s": "video/iso.segment" };

async function serveSample(name) {
  if (!/^[a-z0-9]+\.(m3u8|mp4|m4s)$/.test(name)) return null;
  try {
    const data = await readFile(join(FIXTURES, name));
    return { status: 200, raw: data, headers: { "content-type": STATIC_TYPES[name.slice(name.lastIndexOf("."))] } };
  } catch {
    return null;
  }
}

function thumbnailSvg(name) {
  const palette = { vocals: ["#ff7a1a", "#8a2be2"], kitchen: ["#14b37d", "#f4c152"] }[name];
  if (!palette) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="980" cy="260" r="180" fill="rgba(255,255,255,0.15)"/></svg>`;
  return { status: 200, raw: Buffer.from(svg), headers: { "content-type": "image/svg+xml" } };
}

// ---------------------------------------------------------------------------------------------
// Server

function corsHeaders(req) {
  const origin = req.headers.origin;
  return origin && CORS_ORIGINS.includes(origin)
    ? { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-headers": "content-type, range" }
    : {};
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw validation([{ field: "body", message: "body must be valid JSON" }]);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", PUBLIC_URL);
  const cors = corsHeaders(req);
  if (LOG) console.log(`${req.method} ${url.pathname}`);

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, HEAD, OPTIONS" });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/sample/")) {
      const file = await serveSample(url.pathname.slice("/sample/".length));
      if (file) {
        res.writeHead(200, { ...file.headers, ...cors, "cache-control": "no-store" });
        res.end(file.raw);
        return;
      }
    }
    if (req.method === "GET" && url.pathname.startsWith("/static/thumbs/")) {
      const file = thumbnailSvg(url.pathname.slice("/static/thumbs/".length).replace(/\.svg$/, ""));
      if (file) {
        res.writeHead(200, { ...file.headers, "cache-control": "public, max-age=3600" });
        res.end(file.raw);
        return;
      }
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.regex.exec(url.pathname);
      if (!match) continue;
      const params = Object.fromEntries(r.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
      const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : undefined;
      const result = await r.handler({ req, params, query: url.searchParams, body });
      const isMedia = url.pathname.startsWith("/v1/dev/media/");
      const headers = { ...(isMedia ? cors : {}), ...(result.headers ?? {}) };
      if (result.body === undefined) {
        res.writeHead(result.status, headers);
        res.end();
      } else {
        res.writeHead(result.status, { ...headers, "content-type": "application/json" });
        res.end(JSON.stringify(result.body));
      }
      return;
    }
    throw new HttpError(404, "NOT_FOUND", "Route not found");
  } catch (error) {
    const known = error instanceof HttpError;
    const statusCode = known ? error.statusCode : 500;
    const body = known
      ? { statusCode, code: error.code, message: error.message, ...(error.errors ? { errors: error.errors } : {}) }
      : { statusCode: 500, code: "INTERNAL", message: "Internal error" };
    if (!known) console.error(error);
    const isMedia = url.pathname.startsWith("/v1/dev/media/") || url.pathname.startsWith("/sample/");
    res.writeHead(statusCode, { ...(isMedia ? cors : {}), "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }
});

server.listen(PORT, () => {
  console.log(`Mock API listening on ${PUBLIC_URL} (heartbeat ${HEARTBEAT_INTERVAL}s, access token ${ACCESS_TTL}s)`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
