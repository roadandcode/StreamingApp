#!/usr/bin/env node
/**
 * In-memory stand-in for the v1 API (docs/architecture/api-contract.md), covering only the
 * endpoints the admin dashboard and its e2e tests use. It follows the contract's shapes, error
 * format (including field errors on 400 VALIDATION_FAILED), auth rules (bearer access tokens,
 * rotating refresh tokens with reuse detection, admin-only /v1/admin/*), content rules and the
 * fake media upload URL.
 *
 *   node e2e/mock-api.mjs            # http://localhost:3100
 *
 * Environment (all optional):
 *   MOCK_API_PORT                   default 3100
 *   MOCK_PUBLIC_BASE_URL            base of the fake upload URLs, default http://localhost:<port>
 *   MOCK_CORS_ORIGINS               comma-separated, default http://localhost:3001,http://localhost:3002
 *   MOCK_ACCESS_TOKEN_TTL_SECONDS   default 900
 *   MOCK_PROCESSING_DELAY_MS        time between the upload PUT and the asset becoming ready, default 0
 *   MOCK_UPLOAD_HEADERS             JSON object returned as upload-session `headers`, default {}
 *   MOCK_QUIET=1                    no request log
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD  seeded accounts
 *
 * Routes under /__mock/* are test controls, not part of the API; a real API answers 404 there.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 3100);
const PUBLIC_BASE_URL = (process.env.MOCK_PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const CORS_ORIGINS = (process.env.MOCK_CORS_ORIGINS ?? "http://localhost:3001,http://localhost:3002")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.MOCK_ACCESS_TOKEN_TTL_SECONDS ?? 900);
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const PROCESSING_DELAY_MS = Number(process.env.MOCK_PROCESSING_DELAY_MS ?? 0);
const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const MAX_DEVICES = 3;
const QUIET = process.env.MOCK_QUIET === "1";
const MEDIA_SIGNING_SECRET = randomBytes(32);

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.test";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin-password-123";
const VIEWER_EMAIL = process.env.E2E_VIEWER_EMAIL ?? "viewer@example.test";
const VIEWER_PASSWORD = process.env.E2E_VIEWER_PASSWORD ?? "viewer-password-123";

const KINDS = ["course", "lesson", "video"];
const ACCESS_TIERS = ["free", "premium"];
const STATUSES = ["draft", "published", "unpublished"];
const PLATFORMS = ["android", "ios", "web"];

// ---------------------------------------------------------------------------------------------
// Errors and validation
// ---------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(statusCode, code, message, errors) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }
}

const fail = (statusCode, code, message) => {
  throw new HttpError(statusCode, code, message);
};
const notFound = (what = "Resource") => fail(404, "NOT_FOUND", `${what} not found.`);

function validationError(errors) {
  return new HttpError(400, "VALIDATION_FAILED", errors.map((error) => error.message).join("; "), errors);
}

/** Fails with a single field error. */
const invalid = (field, message) => {
  throw validationError([{ field, message }]);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const REGION = /^[A-Z]{2}$/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Collects every field error of a request, like the API's validation, then fails with all of them. */
class Checks {
  constructor() {
    this.errors = [];
  }

  add(field, message) {
    this.errors.push({ field, message });
  }

  done() {
    if (this.errors.length > 0) throw validationError(this.errors);
  }

  unknown(record, allowed) {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) this.add(key, `property ${key} should not exist`);
    }
  }

  string(record, key, { max = 10_000, optional = false } = {}) {
    const value = record[key];
    if (value === undefined && optional) return undefined;
    if (typeof value !== "string") return this.add(key, `${key} must be a string`);
    if (value.trim().length === 0) return this.add(key, `${key} should not be empty`);
    if (value.length > max) return this.add(key, `${key} must be shorter than or equal to ${max} characters`);
    return value;
  }

  oneOf(record, key, values, { optional = false } = {}) {
    const value = record[key];
    if (value === undefined && optional) return undefined;
    if (!values.includes(value)) return this.add(key, `${key} must be one of the following values: ${values.join(", ")}`);
    return value;
  }
}

function checkBody(body) {
  if (!isObject(body)) invalid("", "body must be a JSON object");
  return new Checks();
}

function checkQuery(query, allowed) {
  const checks = new Checks();
  for (const key of query.keys()) {
    if (!allowed.includes(key)) checks.add(key, `property ${key} should not exist`);
  }
  return checks;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

const now = () => new Date();
const iso = (date) => date.toISOString();
const ago = (minutes) => iso(new Date(Date.now() - minutes * 60_000));

const users = new Map(); // id -> { user, password, subscription }
const accessTokens = new Map(); // token -> { userId, expiresAt }
const refreshTokens = new Map(); // token -> { userId, familyId, expiresAt, used }
const revokedFamilies = new Set();
const content = new Map(); // id -> AdminContent (+ providerAssetId)
const uploads = new Map(); // providerAssetId -> { contentId, assetId, headers }
const devices = new Map(); // id -> Device & { userId, blocked }
const playbackSessions = new Map(); // id -> { ..., userId, endedAt }
const auditLog = [];

// Test-control state.
let uploadHeaders = parseUploadHeaders(process.env.MOCK_UPLOAD_HEADERS);
let lastUpload = null;
const scriptedFailures = [];

function parseUploadHeaders(raw) {
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!isObject(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("MOCK_UPLOAD_HEADERS must be a JSON object of strings.");
  }
  return parsed;
}

function addUser({ email, password, role, displayName, subscription, daysAgo }) {
  const user = {
    id: randomUUID(),
    email,
    displayName,
    role,
    accountStatus: "active",
    createdAt: ago(60 * 24 * daysAgo),
  };
  users.set(user.id, {
    user,
    password,
    subscription: subscription ?? {
      status: "none",
      hasAccess: false,
      accessTier: null,
      planCode: null,
      provider: null,
      accessUntil: null,
      autoRenewEnabled: false,
    },
  });
  return user;
}

function addContent(fields) {
  const timestamp = ago(60 * 24 * 7);
  const item = {
    id: randomUUID(),
    thumbnailUrl: null,
    ageRating: null,
    durationSeconds: null,
    parentId: null,
    position: 0,
    regions: ["IN"],
    asset: null,
    publicationStatus: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields,
  };
  content.set(item.id, item);
  return item;
}

function readyAsset() {
  return { id: randomUUID(), processingStatus: "ready" };
}

function seed() {
  addUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: "admin", displayName: "Admin", daysAgo: 40 });
  const viewer = addUser({
    email: VIEWER_EMAIL,
    password: VIEWER_PASSWORD,
    role: "viewer",
    displayName: "Priya Sharma",
    daysAgo: 30,
    subscription: {
      status: "active",
      hasAccess: true,
      accessTier: "premium",
      planCode: "premium_monthly",
      provider: "fake",
      accessUntil: iso(new Date(Date.now() + 20 * 24 * 60 * 60_000)),
      autoRenewEnabled: true,
    },
  });
  addUser({
    email: "rahul.verma@example.test",
    password: "unused-password-1",
    role: "viewer",
    displayName: "Rahul Verma",
    daysAgo: 10,
  });

  const course = addContent({
    kind: "course",
    title: "Hindi for Beginners",
    description: "Learn conversational Hindi in short lessons.",
    accessTier: "premium",
    defaultLanguage: "hi",
    ageRating: "U",
    thumbnailUrl: "https://images.example.test/hindi-for-beginners.jpg",
    publicationStatus: "published",
  });
  const lessonOne = addContent({
    kind: "lesson",
    title: "Greetings and introductions",
    description: "Namaste and beyond.",
    accessTier: "premium",
    defaultLanguage: "hi",
    parentId: course.id,
    position: 0,
    durationSeconds: 512,
    asset: readyAsset(),
    publicationStatus: "published",
  });
  addContent({
    kind: "lesson",
    title: "Numbers and counting",
    description: "Count from one to one hundred.",
    accessTier: "premium",
    defaultLanguage: "hi",
    parentId: course.id,
    position: 1,
    durationSeconds: 634,
    asset: readyAsset(),
    publicationStatus: "published",
  });
  addContent({
    kind: "video",
    title: "Monsoon in Kerala",
    description: "A short documentary.",
    accessTier: "free",
    defaultLanguage: "ml",
    ageRating: "U",
    regions: ["IN", "NP"],
  });

  const phone = {
    id: randomUUID(),
    userId: viewer.id,
    installationId: randomUUID(),
    platform: "android",
    name: "Pixel 8",
    lastSeenAt: ago(5),
    createdAt: ago(60 * 24 * 30),
    revokedAt: null,
    blocked: false,
  };
  const oldPhone = {
    id: randomUUID(),
    userId: viewer.id,
    installationId: randomUUID(),
    platform: "ios",
    name: "Old iPhone",
    lastSeenAt: ago(60 * 24 * 60),
    createdAt: ago(60 * 24 * 300),
    revokedAt: ago(60 * 24 * 59),
    blocked: true,
  };
  devices.set(phone.id, phone);
  devices.set(oldPhone.id, oldPhone);

  const playback = {
    id: randomUUID(),
    userId: viewer.id,
    contentId: lessonOne.id,
    deviceId: phone.id,
    startedAt: ago(12),
    lastHeartbeatAt: ago(0.5),
    endedAt: null,
  };
  playbackSessions.set(playback.id, playback);
}

seed();

// ---------------------------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------------------------

const token = () => randomBytes(32).toString("base64url");

function issueTokens(userId, familyId = randomUUID()) {
  const accessToken = token();
  const refreshToken = token();
  const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  accessTokens.set(accessToken, { userId, expiresAt: accessTokenExpiresAt.getTime() });
  refreshTokens.set(refreshToken, { userId, familyId, expiresAt: refreshTokenExpiresAt.getTime(), used: false });
  return {
    accessToken,
    accessTokenExpiresAt: iso(accessTokenExpiresAt),
    refreshToken,
    refreshTokenExpiresAt: iso(refreshTokenExpiresAt),
  };
}

/** Revokes every login session of a user; their access tokens stop working immediately. */
function revokeAllSessionsOf(userId) {
  for (const record of refreshTokens.values()) {
    if (record.userId === userId) revokedFamilies.add(record.familyId);
  }
  for (const [accessToken, record] of accessTokens) {
    if (record.userId === userId) accessTokens.delete(accessToken);
  }
}

function authenticate(req) {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) fail(401, "UNAUTHENTICATED", "Missing access token.");
  const record = accessTokens.get(match[1]);
  if (!record || record.expiresAt <= Date.now()) fail(401, "UNAUTHENTICATED", "Invalid or expired access token.");
  const entry = users.get(record.userId);
  if (!entry) fail(401, "UNAUTHENTICATED", "Invalid access token.");
  if (entry.user.accountStatus !== "active") fail(403, "ACCOUNT_INACTIVE", "Account suspended or deleted.");
  return entry.user;
}

function requireAdmin(req) {
  const user = authenticate(req);
  if (user.role !== "admin") fail(403, "FORBIDDEN", "Admin role required.");
  return user;
}

function audit(actor, action, target) {
  auditLog.push({ actorId: actor.id, action, target, at: iso(now()) });
}

// ---------------------------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------------------------

function publicContent(item) {
  const { providerAssetId: _providerAssetId, ...rest } = item;
  return { ...rest, regions: [...rest.regions], asset: rest.asset ? { ...rest.asset } : null };
}

/** Siblings by 0-based position; ties sort by createdAt. */
const byPosition = (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);

function childrenOf(id) {
  return [...content.values()]
    .filter((item) => item.parentId === id)
    .sort(byPosition)
    .map(publicContent);
}

function findContent(id) {
  const item = UUID.test(id) ? content.get(id) : undefined;
  if (!item) notFound("Content");
  return item;
}

const CREATE_FIELDS = [
  "kind",
  "title",
  "description",
  "accessTier",
  "defaultLanguage",
  "ageRating",
  "thumbnailUrl",
  "parentId",
  "position",
  "regions",
];
const PATCH_FIELDS = [
  "title",
  "description",
  "accessTier",
  "defaultLanguage",
  "ageRating",
  "thumbnailUrl",
  "position",
  "regions",
];

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateContent(body, { partial }) {
  const checks = checkBody(body);
  if (partial) {
    for (const key of ["kind", "parentId"]) {
      if (key in body) checks.add(key, `${key} cannot be changed`);
    }
    checks.unknown(body, [...PATCH_FIELDS, "kind", "parentId"]);
  } else {
    checks.unknown(body, CREATE_FIELDS);
  }

  const out = {};
  const optional = { optional: partial };
  if (!partial) out.kind = checks.oneOf(body, "kind", KINDS);
  const title = checks.string(body, "title", { max: 200, ...optional });
  if (title !== undefined) out.title = title.trim();
  if (body.description !== undefined || !partial) {
    if (typeof body.description !== "string") checks.add("description", "description must be a string");
    else out.description = body.description;
  }
  const accessTier = checks.oneOf(body, "accessTier", ACCESS_TIERS, optional);
  if (accessTier !== undefined) out.accessTier = accessTier;
  const defaultLanguage = checks.string(body, "defaultLanguage", { max: 35, ...optional });
  if (defaultLanguage !== undefined) {
    if (LANGUAGE.test(defaultLanguage)) out.defaultLanguage = defaultLanguage;
    else checks.add("defaultLanguage", "defaultLanguage must be a BCP-47 language tag");
  }
  if (body.ageRating !== undefined) {
    if (body.ageRating !== null && (typeof body.ageRating !== "string" || body.ageRating.length > 20)) {
      checks.add("ageRating", "ageRating must be a string of at most 20 characters");
    } else {
      out.ageRating = body.ageRating;
    }
  }
  if (body.thumbnailUrl !== undefined) {
    const value = body.thumbnailUrl;
    if (value !== null && (typeof value !== "string" || value.length > 2048 || !isHttpUrl(value))) {
      checks.add("thumbnailUrl", "thumbnailUrl must be an http(s) URL of at most 2048 characters");
    } else {
      out.thumbnailUrl = value;
    }
  }
  if (!partial && body.parentId !== undefined) {
    if (typeof body.parentId !== "string" || !UUID.test(body.parentId)) checks.add("parentId", "parentId must be a UUID");
    else out.parentId = body.parentId;
  }
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position) || body.position < 0) {
      checks.add("position", "position must be a non-negative integer");
    } else {
      out.position = body.position;
    }
  }
  if (body.regions !== undefined || !partial) {
    if (!Array.isArray(body.regions) || body.regions.length === 0) {
      checks.add("regions", "regions must contain at least 1 element");
    } else {
      body.regions.forEach((region, index) => {
        if (typeof region !== "string" || !REGION.test(region)) {
          checks.add(`regions.${index}`, "each value in regions must be an ISO-3166 alpha-2 code");
        }
      });
      out.regions = [...new Set(body.regions)];
    }
  }
  checks.done();
  return out;
}

function signUpload(providerAssetId, exp) {
  return createHmac("sha256", MEDIA_SIGNING_SECRET).update(`${providerAssetId}.${exp}`).digest("hex");
}

function verifyUploadSignature(providerAssetId, exp, sig) {
  if (!/^\d+$/.test(exp ?? "") || !/^[0-9a-f]{64}$/.test(sig ?? "")) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = Buffer.from(signUpload(providerAssetId, exp), "hex");
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}

// ---------------------------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------------------------

function pageQuery(query, checks) {
  const page = query.get("page") === null ? 1 : Number(query.get("page"));
  const pageSize = query.get("pageSize") === null ? 20 : Number(query.get("pageSize"));
  if (!Number.isInteger(page) || page < 1) checks.add("page", "page must be a positive integer");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    checks.add("pageSize", "pageSize must be between 1 and 100");
  }
  return { page, pageSize };
}

function paginate(items, { page, pageSize }) {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(
    `^${pattern.replace(/:(\w+)/g, (_match, key) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, regex, keys, handler });
};

route("GET", "/v1/health", () => ({ status: 200, body: { status: "ok", db: "ok" } }));

route("POST", "/v1/auth/login", ({ body }) => {
  const checks = checkBody(body);
  checks.unknown(body, ["email", "password"]);
  const email = checks.string(body, "email");
  const password = checks.string(body, "password");
  checks.done();
  const needle = email.trim().toLowerCase();
  const entry = [...users.values()].find((candidate) => candidate.user.email.toLowerCase() === needle);
  if (!entry || entry.password !== password) fail(401, "INVALID_CREDENTIALS", "Wrong email or password.");
  if (entry.user.accountStatus !== "active") fail(403, "ACCOUNT_INACTIVE", "Account suspended or deleted.");
  return { status: 200, body: { user: entry.user, tokens: issueTokens(entry.user.id) } };
});

route("POST", "/v1/auth/refresh", ({ body }) => {
  const checks = checkBody(body);
  checks.unknown(body, ["refreshToken"]);
  const presented = checks.string(body, "refreshToken");
  checks.done();
  const record = refreshTokens.get(presented);
  if (!record || record.expiresAt <= Date.now() || revokedFamilies.has(record.familyId)) {
    fail(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.");
  }
  if (record.used) {
    revokedFamilies.add(record.familyId);
    fail(401, "INVALID_REFRESH_TOKEN", "Refresh token reuse detected; the session was revoked.");
  }
  record.used = true;
  return { status: 200, body: { tokens: issueTokens(record.userId, record.familyId) } };
});

// 204 also for an unknown or already-revoked token.
route("POST", "/v1/auth/logout", ({ body }) => {
  const checks = checkBody(body);
  checks.unknown(body, ["refreshToken"]);
  const presented = checks.string(body, "refreshToken");
  checks.done();
  const record = refreshTokens.get(presented);
  if (record) revokedFamilies.add(record.familyId);
  return { status: 204 };
});

route("GET", "/v1/me", ({ req }) => ({ status: 200, body: authenticate(req) }));

route("GET", "/v1/me/devices", ({ req }) => {
  const user = authenticate(req);
  const list = [...devices.values()]
    .filter((device) => device.userId === user.id && device.revokedAt === null)
    .map(publicDevice);
  return { status: 200, body: list };
});

route("POST", "/v1/me/devices", ({ req, body }) => {
  const user = authenticate(req);
  const checks = checkBody(body);
  checks.unknown(body, ["installationId", "platform", "name"]);
  const installationId = checks.string(body, "installationId");
  if (installationId !== undefined && !UUID.test(installationId)) checks.add("installationId", "installationId must be a UUID");
  const platform = checks.oneOf(body, "platform", PLATFORMS);
  const name = checks.string(body, "name", { max: 100 });
  checks.done();

  const active = [...devices.values()].filter((device) => device.userId === user.id && device.revokedAt === null);
  const existing = [...devices.values()].find(
    (device) => device.userId === user.id && device.installationId === installationId,
  );
  if (existing) {
    if (existing.blocked) fail(403, "DEVICE_REVOKED", "This device was blocked by an administrator.");
    if (existing.revokedAt !== null) {
      // Removed by its owner: it may register again, subject to the device limit.
      if (active.length >= MAX_DEVICES) fail(409, "DEVICE_LIMIT_REACHED", `At most ${MAX_DEVICES} devices can be active.`);
      existing.revokedAt = null;
    }
    existing.name = name;
    existing.platform = platform;
    existing.lastSeenAt = iso(now());
    return { status: 200, body: publicDevice(existing) };
  }
  if (active.length >= MAX_DEVICES) fail(409, "DEVICE_LIMIT_REACHED", `At most ${MAX_DEVICES} devices can be active.`);
  const device = {
    id: randomUUID(),
    userId: user.id,
    installationId,
    platform,
    name,
    lastSeenAt: iso(now()),
    createdAt: iso(now()),
    revokedAt: null,
    blocked: false,
  };
  devices.set(device.id, device);
  return { status: 201, body: publicDevice(device) };
});

route("DELETE", "/v1/me/devices/:id", ({ req, params }) => {
  const user = authenticate(req);
  const device = devices.get(params.id);
  if (!device || device.userId !== user.id) notFound("Device");
  deactivateDevice(device, { blocked: false });
  return { status: 204 };
});

function publicDevice(device) {
  const { userId: _userId, blocked: _blocked, ...rest } = device;
  return rest;
}

function deactivateDevice(device, { blocked }) {
  device.revokedAt ??= iso(now());
  if (blocked) device.blocked = true;
  for (const session of playbackSessions.values()) {
    if (session.deviceId === device.id) session.endedAt ??= iso(now());
  }
}

// Admin: content ------------------------------------------------------------------------------

route("GET", "/v1/admin/content", ({ req, query }) => {
  requireAdmin(req);
  const checks = checkQuery(query, ["kind", "status", "parentId", "page", "pageSize"]);
  const kind = query.get("kind");
  const status = query.get("status");
  const parentId = query.get("parentId");
  if (kind !== null && !KINDS.includes(kind)) checks.add("kind", `kind must be one of ${KINDS.join(", ")}`);
  if (status !== null && !STATUSES.includes(status)) checks.add("status", `status must be one of ${STATUSES.join(", ")}`);
  if (parentId !== null && !UUID.test(parentId)) checks.add("parentId", "parentId must be a UUID");
  const paging = pageQuery(query, checks);
  checks.done();
  // Without parentId: top-level items, newest updatedAt first. With parentId: its children by position.
  const items = [...content.values()]
    .filter((item) => (kind === null || item.kind === kind) && (status === null || item.publicationStatus === status))
    .filter((item) => item.parentId === parentId)
    .sort(parentId === null ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) : byPosition)
    .map(publicContent);
  return { status: 200, body: paginate(items, paging) };
});

route("POST", "/v1/admin/content", ({ req, body }) => {
  const admin = requireAdmin(req);
  const fields = validateContent(body, { partial: false });
  const rules = new Checks();
  if (fields.kind === "lesson") {
    const parent = fields.parentId ? content.get(fields.parentId) : undefined;
    if (!fields.parentId) rules.add("parentId", "parentId is required for a lesson");
    else if (!parent || parent.kind !== "course") rules.add("parentId", "parentId must reference a course");
  } else if (fields.parentId) {
    rules.add("parentId", "parentId is only allowed for a lesson");
  }
  rules.done();
  const parentId = fields.parentId ?? null;
  if (fields.position === undefined) {
    // Goes last among its siblings (0-based).
    const siblings = [...content.values()].filter((item) => item.parentId === parentId);
    fields.position = siblings.length === 0 ? 0 : Math.max(...siblings.map((item) => item.position)) + 1;
  }
  const timestamp = iso(now());
  const item = addContent({ ...fields, parentId, createdAt: timestamp, updatedAt: timestamp });
  audit(admin, "content.create", item.id);
  return { status: 201, body: publicContent(item) };
});

route("GET", "/v1/admin/content/:id", ({ req, params }) => {
  requireAdmin(req);
  const item = findContent(params.id);
  return { status: 200, body: { ...publicContent(item), children: childrenOf(item.id) } };
});

route("PATCH", "/v1/admin/content/:id", ({ req, params, body }) => {
  const admin = requireAdmin(req);
  const item = findContent(params.id);
  const fields = validateContent(body, { partial: true });
  Object.assign(item, fields, { updatedAt: iso(now()) });
  audit(admin, "content.update", item.id);
  return { status: 200, body: publicContent(item) };
});

route("POST", "/v1/admin/content/:id/upload-session", ({ req, params }) => {
  const admin = requireAdmin(req);
  const item = findContent(params.id);
  if (item.kind === "course") invalid("kind", "a course has no video; upload videos to its lessons");
  // Uploading again replaces the asset.
  const providerAssetId = `fake-${randomBytes(8).toString("hex")}`;
  const asset = { id: randomUUID(), processingStatus: "awaiting_upload" };
  item.asset = asset;
  item.providerAssetId = providerAssetId;
  item.updatedAt = iso(now());
  const headers = { ...uploadHeaders };
  uploads.set(providerAssetId, { contentId: item.id, assetId: asset.id, headers });
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_URL_TTL_SECONDS;
  const uploadUrl = `${PUBLIC_BASE_URL}/v1/dev/media/uploads/${providerAssetId}?exp=${exp}&sig=${signUpload(providerAssetId, String(exp))}`;
  audit(admin, "content.upload_session", item.id);
  return {
    status: 201,
    body: { videoAssetId: asset.id, uploadUrl, method: "PUT", headers, expiresAt: iso(new Date(exp * 1000)) },
  };
});

route("POST", "/v1/admin/content/:id/publish", ({ req, params }) => {
  const admin = requireAdmin(req);
  const item = findContent(params.id);
  if (item.kind !== "course" && item.asset?.processingStatus !== "ready") {
    fail(409, "ASSET_NOT_READY", "The video asset is not ready.");
  }
  item.publicationStatus = "published";
  item.updatedAt = iso(now());
  audit(admin, "content.publish", item.id);
  return { status: 200, body: publicContent(item) };
});

route("POST", "/v1/admin/content/:id/unpublish", ({ req, params }) => {
  const admin = requireAdmin(req);
  const item = findContent(params.id);
  item.publicationStatus = "unpublished";
  item.updatedAt = iso(now());
  audit(admin, "content.unpublish", item.id);
  return { status: 200, body: publicContent(item) };
});

/**
 * Fake media upload: a PUT with any body to a correctly signed, unexpired URL, carrying the
 * headers the upload session returned, marks the asset ready (after MOCK_PROCESSING_DELAY_MS).
 */
route("PUT", "/v1/dev/media/uploads/:providerAssetId", async ({ req, params, query }) => {
  await drain(req);
  lastUpload = { headers: { ...req.headers } };
  const upload = uploads.get(params.providerAssetId);
  if (!upload || !verifyUploadSignature(params.providerAssetId, query.get("exp"), query.get("sig"))) {
    fail(401, "INVALID_SIGNATURE", "Upload URL signature is invalid or expired.");
  }
  for (const [name, value] of Object.entries(upload.headers)) {
    if (req.headers[name.toLowerCase()] !== value) {
      fail(401, "INVALID_SIGNATURE", `Upload header ${name} does not match the signed request.`);
    }
  }
  const item = content.get(upload.contentId);
  if (!item || item.asset?.id !== upload.assetId) notFound("Upload");
  const markReady = () => {
    item.asset = { id: upload.assetId, processingStatus: "ready" };
    item.durationSeconds ??= 90;
    item.updatedAt = iso(now());
  };
  if (PROCESSING_DELAY_MS > 0) {
    item.asset = { id: upload.assetId, processingStatus: "processing" };
    setTimeout(markReady, PROCESSING_DELAY_MS);
  } else {
    markReady();
  }
  return { status: 204 };
});

// Admin: users --------------------------------------------------------------------------------

route("GET", "/v1/admin/users", ({ req, query }) => {
  requireAdmin(req);
  const checks = checkQuery(query, ["email", "page", "pageSize"]);
  const paging = pageQuery(query, checks);
  checks.done();
  // email is an optional case-insensitive substring; results are newest first.
  const needle = (query.get("email") ?? "").trim().toLowerCase();
  const items = [...users.values()]
    .filter((entry) => entry.user.email.toLowerCase().includes(needle))
    .sort((a, b) => b.user.createdAt.localeCompare(a.user.createdAt))
    .map((entry) => ({ user: entry.user, subscription: entry.subscription }));
  return { status: 200, body: paginate(items, paging) };
});

route("GET", "/v1/admin/users/:id", ({ req, params }) => {
  requireAdmin(req);
  const entry = UUID.test(params.id) ? users.get(params.id) : undefined;
  if (!entry) notFound("User");
  const userDevices = [...devices.values()].filter((device) => device.userId === entry.user.id).map(publicDevice);
  const activePlaybackSessions = [...playbackSessions.values()]
    .filter((session) => session.userId === entry.user.id && session.endedAt === null)
    .map((session) => ({
      id: session.id,
      contentId: session.contentId,
      contentTitle: content.get(session.contentId)?.title ?? "Unknown content",
      deviceId: session.deviceId,
      startedAt: session.startedAt,
      lastHeartbeatAt: session.lastHeartbeatAt,
    }));
  return {
    status: 200,
    body: { user: entry.user, subscription: entry.subscription, devices: userDevices, activePlaybackSessions },
  };
});

route("POST", "/v1/admin/users/:id/sessions/revoke", ({ req, params }) => {
  const admin = requireAdmin(req);
  const entry = UUID.test(params.id) ? users.get(params.id) : undefined;
  if (!entry) notFound("User");
  revokeAllSessionsOf(entry.user.id);
  audit(admin, "user.sessions_revoke", entry.user.id);
  return { status: 204 };
});

// Blocks the device permanently: registering it again returns 403 DEVICE_REVOKED.
route("POST", "/v1/admin/devices/:id/revoke", ({ req, params }) => {
  const admin = requireAdmin(req);
  const device = devices.get(params.id);
  if (!device) notFound("Device");
  deactivateDevice(device, { blocked: true });
  audit(admin, "device.revoke", device.id);
  return { status: 204 };
});

route("POST", "/v1/admin/playback-sessions/:id/revoke", ({ req, params }) => {
  const admin = requireAdmin(req);
  const session = playbackSessions.get(params.id);
  if (!session) notFound("Playback session");
  session.endedAt ??= iso(now());
  audit(admin, "playback_session.revoke", session.id);
  return { status: 204 };
});

// Test controls -------------------------------------------------------------------------------

route("GET", "/__mock/state", () => ({ status: 200, body: { mock: true } }));

/** Every access token is rejected from now on; refresh tokens keep working. */
route("POST", "/__mock/expire-access-tokens", () => {
  accessTokens.clear();
  return { status: 204 };
});

route("POST", "/__mock/revoke-all-sessions", () => {
  accessTokens.clear();
  for (const record of refreshTokens.values()) revokedFamilies.add(record.familyId);
  return { status: 204 };
});

/** The next request with this method and path gets the given status and JSON body. */
route("POST", "/__mock/fail-next", ({ body }) => {
  if (!isObject(body) || typeof body.method !== "string" || typeof body.path !== "string" || !Number.isInteger(body.status)) {
    invalid("", "expected { method, path, status, body }");
  }
  scriptedFailures.push({ method: body.method.toUpperCase(), path: body.path, status: body.status, body: body.body });
  return { status: 204 };
});

/** Headers returned by upload sessions created from now on. */
route("POST", "/__mock/upload-headers", ({ body }) => {
  if (!isObject(body) || !isObject(body.headers) || Object.values(body.headers).some((value) => typeof value !== "string")) {
    invalid("headers", "expected { headers: Record<string, string> }");
  }
  uploadHeaders = { ...body.headers };
  return { status: 204 };
});

/** Request headers of the most recent upload PUT. */
route("GET", "/__mock/last-upload", () => ({ status: 200, body: lastUpload ?? { headers: null } }));

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------

function drain(req) {
  return new Promise((resolve, reject) => {
    req.on("data", () => {});
    req.on("end", resolve);
    req.on("error", reject);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(validationError([{ field: "", message: "Request body too large." }]));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(validationError([{ field: "", message: "Malformed JSON body." }]));
      }
    });
    req.on("error", reject);
  });
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !CORS_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function send(res, status, body, extraHeaders) {
  const headers = { ...extraHeaders };
  if (body !== undefined && status !== 204) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  } else {
    res.writeHead(status, headers);
    res.end();
  }
}

function errorBody(error) {
  const body = { statusCode: error.statusCode, code: error.code, message: error.message };
  if (error.code === "VALIDATION_FAILED") body.errors = error.errors ?? [];
  return body;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const cors = corsHeaders(req);
  let status = 500;
  try {
    if (req.method === "OPTIONS") {
      status = 204;
      return send(res, status, undefined, cors);
    }
    const scripted = scriptedFailures.findIndex(
      (failure) => failure.method === req.method && failure.path === url.pathname,
    );
    if (scripted !== -1) {
      const [failure] = scriptedFailures.splice(scripted, 1);
      await drain(req);
      status = failure.status;
      return send(res, status, failure.body, cors);
    }
    const match = routes
      .map((candidate) => ({ candidate, result: candidate.regex.exec(url.pathname) }))
      .find(({ candidate, result }) => result && candidate.method === req.method);
    if (!match) {
      await drain(req);
      fail(404, "NOT_FOUND", `Cannot ${req.method} ${url.pathname}`);
    }
    const params = Object.fromEntries(
      match.candidate.keys.map((key, index) => [key, decodeURIComponent(match.result[index + 1])]),
    );
    const isUpload = url.pathname.startsWith("/v1/dev/media/uploads/");
    const body = isUpload ? undefined : await readJson(req);
    const result = await match.candidate.handler({ req, params, query: url.searchParams, body });
    status = result.status;
    send(res, status, result.body, cors);
  } catch (error) {
    if (error instanceof HttpError) {
      status = error.statusCode;
      send(res, status, errorBody(error), cors);
    } else {
      console.error(error);
      status = 500;
      send(res, status, { statusCode: 500, code: "INTERNAL_ERROR", message: "Internal server error." }, cors);
    }
  } finally {
    if (!QUIET) {
      console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Mock API listening on http://localhost:${PORT} (admin: ${ADMIN_EMAIL}, viewer: ${VIEWER_EMAIL})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
