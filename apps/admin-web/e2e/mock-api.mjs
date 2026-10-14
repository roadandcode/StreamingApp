#!/usr/bin/env node
/**
 * In-memory stand-in for the v1 API (docs/architecture/api-contract.md), covering only the
 * endpoints the admin dashboard and its smoke test use. It follows the contract's shapes, error
 * format and auth rules (bearer access tokens, rotating refresh tokens with reuse detection,
 * admin-only /v1/admin/*), plus the fake media upload URL.
 *
 *   node e2e/mock-api.mjs            # http://localhost:3100
 *
 * Environment (all optional):
 *   MOCK_API_PORT                   default 3100
 *   MOCK_PUBLIC_BASE_URL            base of the fake upload URLs, default http://localhost:<port>
 *   MOCK_CORS_ORIGINS               comma-separated, default http://localhost:3001
 *   MOCK_ACCESS_TOKEN_TTL_SECONDS   default 900
 *   MOCK_PROCESSING_DELAY_MS        time between the upload PUT and the asset becoming ready, default 0
 *   MOCK_QUIET=1                    no request log
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD  seeded accounts
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 3100);
const PUBLIC_BASE_URL = (process.env.MOCK_PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const CORS_ORIGINS = (process.env.MOCK_CORS_ORIGINS ?? "http://localhost:3001")
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

// ---------------------------------------------------------------------------------------------
// Errors and validation
// ---------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const fail = (statusCode, code, message) => {
  throw new HttpError(statusCode, code, message);
};
const invalid = (message) => fail(400, "VALIDATION_FAILED", message);
const notFound = (what = "Resource") => fail(404, "NOT_FOUND", `${what} not found.`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const REGION = /^[A-Z]{2}$/;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function rejectUnknown(record, allowed, where = "body") {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) invalid(`property ${key} should not exist in the ${where}`);
  }
}

function requireString(body, key, { min = 1, max = 10_000, optional = false } = {}) {
  const value = body[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") invalid(`${key} must be a string`);
  if (value.trim().length < min) invalid(`${key} should not be empty`);
  if (value.length > max) invalid(`${key} must be shorter than or equal to ${max} characters`);
  return value;
}

function requireEnum(body, key, values, { optional = false } = {}) {
  const value = body[key];
  if (value === undefined && optional) return undefined;
  if (!values.includes(value)) invalid(`${key} must be one of the following values: ${values.join(", ")}`);
  return value;
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
const uploads = new Map(); // providerAssetId -> { contentId, assetId }
const devices = new Map(); // id -> Device & { userId }
const playbackSessions = new Map(); // id -> { ..., userId, endedAt }
const auditLog = [];

function addUser({ email, password, role, displayName, subscription }) {
  const user = {
    id: randomUUID(),
    email,
    displayName,
    role,
    accountStatus: "active",
    createdAt: ago(60 * 24 * 40),
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
  addUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: "admin", displayName: "Admin" });
  const viewer = addUser({
    email: VIEWER_EMAIL,
    password: VIEWER_PASSWORD,
    role: "viewer",
    displayName: "Priya Sharma",
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
  addUser({ email: "rahul.verma@example.test", password: "unused-password-1", role: "viewer", displayName: "Rahul Verma" });

  const course = addContent({
    kind: "course",
    title: "Hindi for Beginners",
    description: "Learn conversational Hindi in short lessons.",
    accessTier: "premium",
    defaultLanguage: "hi",
    ageRating: "U",
    publicationStatus: "published",
  });
  const lessonOne = addContent({
    kind: "lesson",
    title: "Greetings and introductions",
    description: "Namaste and beyond.",
    accessTier: "premium",
    defaultLanguage: "hi",
    parentId: course.id,
    position: 1,
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
    position: 2,
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

function revokeFamiliesOf(userId) {
  for (const record of refreshTokens.values()) {
    if (record.userId === userId) revokedFamilies.add(record.familyId);
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

function childrenOf(id) {
  return [...content.values()]
    .filter((item) => item.parentId === id)
    .sort((a, b) => a.position - b.position)
    .map(publicContent);
}

function findContent(id) {
  const item = UUID.test(id) ? content.get(id) : undefined;
  if (!item) notFound("Content");
  return item;
}

const CONTENT_FIELDS = [
  "kind",
  "title",
  "description",
  "accessTier",
  "defaultLanguage",
  "ageRating",
  "parentId",
  "position",
  "regions",
];

function validateContentFields(body, { partial }) {
  if (!isObject(body)) invalid("body must be an object");
  rejectUnknown(body, CONTENT_FIELDS);
  const out = {};
  const opt = { optional: partial };
  const kind = requireEnum(body, "kind", ["course", "lesson", "video"], opt);
  if (kind !== undefined) out.kind = kind;
  const title = requireString(body, "title", { max: 200, ...opt });
  if (title !== undefined) out.title = title.trim();
  if (body.description !== undefined || !partial) {
    if (typeof body.description !== "string") invalid("description must be a string");
    out.description = body.description;
  }
  const accessTier = requireEnum(body, "accessTier", ["free", "premium"], opt);
  if (accessTier !== undefined) out.accessTier = accessTier;
  const defaultLanguage = requireString(body, "defaultLanguage", { max: 35, ...opt });
  if (defaultLanguage !== undefined) {
    if (!LANGUAGE.test(defaultLanguage)) invalid("defaultLanguage must be a BCP-47 language tag");
    out.defaultLanguage = defaultLanguage;
  }
  if (body.ageRating !== undefined) {
    if (body.ageRating !== null && (typeof body.ageRating !== "string" || body.ageRating.length > 20)) {
      invalid("ageRating must be a string of at most 20 characters");
    }
    out.ageRating = body.ageRating;
  }
  if (body.parentId !== undefined) {
    if (typeof body.parentId !== "string" || !UUID.test(body.parentId)) invalid("parentId must be a UUID");
    out.parentId = body.parentId;
  }
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position) || body.position < 0) invalid("position must be a non-negative integer");
    out.position = body.position;
  }
  if (body.regions !== undefined || !partial) {
    if (!Array.isArray(body.regions) || body.regions.length === 0) invalid("regions must contain at least 1 element");
    for (const region of body.regions) {
      if (typeof region !== "string" || !REGION.test(region)) invalid("each value in regions must be an ISO-3166 alpha-2 code");
    }
    out.regions = [...new Set(body.regions)];
  }
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

function pageQuery(query) {
  const page = query.get("page") === null ? 1 : Number(query.get("page"));
  const pageSize = query.get("pageSize") === null ? 20 : Number(query.get("pageSize"));
  if (!Number.isInteger(page) || page < 1) invalid("page must be a positive integer");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) invalid("pageSize must be between 1 and 100");
  return { page, pageSize };
}

function paginate(items, { page, pageSize }) {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
}

function rejectUnknownQuery(query, allowed) {
  for (const key of query.keys()) {
    if (!allowed.includes(key)) invalid(`property ${key} should not exist in the query`);
  }
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
  if (!isObject(body)) invalid("body must be an object");
  rejectUnknown(body, ["email", "password"]);
  const email = requireString(body, "email").trim().toLowerCase();
  const password = requireString(body, "password");
  const entry = [...users.values()].find((candidate) => candidate.user.email.toLowerCase() === email);
  if (!entry || entry.password !== password) fail(401, "INVALID_CREDENTIALS", "Wrong email or password.");
  if (entry.user.accountStatus !== "active") fail(403, "ACCOUNT_INACTIVE", "Account suspended or deleted.");
  return { status: 200, body: { user: entry.user, tokens: issueTokens(entry.user.id) } };
});

route("POST", "/v1/auth/refresh", ({ body }) => {
  if (!isObject(body)) invalid("body must be an object");
  rejectUnknown(body, ["refreshToken"]);
  const presented = requireString(body, "refreshToken");
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

route("POST", "/v1/auth/logout", ({ body }) => {
  if (!isObject(body)) invalid("body must be an object");
  rejectUnknown(body, ["refreshToken"]);
  const presented = requireString(body, "refreshToken");
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
  if (!isObject(body)) invalid("body must be an object");
  rejectUnknown(body, ["installationId", "platform", "name"]);
  const installationId = requireString(body, "installationId");
  if (!UUID.test(installationId)) invalid("installationId must be a UUID");
  const platform = requireEnum(body, "platform", ["android", "ios", "web"]);
  const name = requireString(body, "name", { max: 100 });
  const existing = [...devices.values()].find(
    (device) => device.userId === user.id && device.installationId === installationId,
  );
  if (existing) {
    if (existing.revokedAt) fail(403, "DEVICE_REVOKED", "This device was revoked.");
    existing.name = name;
    existing.lastSeenAt = iso(now());
    return { status: 200, body: publicDevice(existing) };
  }
  const active = [...devices.values()].filter((device) => device.userId === user.id && device.revokedAt === null);
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
  };
  devices.set(device.id, device);
  return { status: 201, body: publicDevice(device) };
});

route("DELETE", "/v1/me/devices/:id", ({ req, params }) => {
  const user = authenticate(req);
  const device = devices.get(params.id);
  if (!device || device.userId !== user.id) notFound("Device");
  revokeDeviceRecord(device);
  return { status: 204 };
});

function publicDevice(device) {
  const { userId: _userId, ...rest } = device;
  return rest;
}

function revokeDeviceRecord(device) {
  device.revokedAt ??= iso(now());
  for (const session of playbackSessions.values()) {
    if (session.deviceId === device.id) session.endedAt ??= iso(now());
  }
}

// Admin: content ------------------------------------------------------------------------------

route("GET", "/v1/admin/content", ({ req, query }) => {
  requireAdmin(req);
  rejectUnknownQuery(query, ["kind", "status", "parentId", "page", "pageSize"]);
  const kind = query.get("kind");
  const status = query.get("status");
  const parentId = query.get("parentId");
  if (kind !== null && !["course", "lesson", "video"].includes(kind)) invalid("kind must be one of course, lesson, video");
  if (status !== null && !["draft", "published", "unpublished"].includes(status)) {
    invalid("status must be one of draft, published, unpublished");
  }
  if (parentId !== null && !UUID.test(parentId)) invalid("parentId must be a UUID");
  const items = [...content.values()]
    .filter((item) => (kind === null || item.kind === kind) && (status === null || item.publicationStatus === status))
    .filter((item) => parentId === null || item.parentId === parentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(publicContent);
  return { status: 200, body: paginate(items, pageQuery(query)) };
});

route("POST", "/v1/admin/content", ({ req, body }) => {
  const admin = requireAdmin(req);
  const fields = validateContentFields(body, { partial: false });
  if (fields.kind === "lesson") {
    if (!fields.parentId) invalid("parentId is required for a lesson");
    const parent = content.get(fields.parentId);
    if (!parent || parent.kind !== "course") invalid("parentId must reference a course");
  } else if (fields.parentId) {
    invalid("parentId is only allowed for a lesson");
  }
  if (fields.kind !== "lesson") delete fields.position;
  if (fields.kind === "lesson" && fields.position === undefined) {
    const siblings = [...content.values()].filter((item) => item.parentId === fields.parentId);
    fields.position = siblings.reduce((max, item) => Math.max(max, item.position), 0) + 1;
  }
  const timestamp = iso(now());
  const item = addContent({ ...fields, createdAt: timestamp, updatedAt: timestamp });
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
  const fields = validateContentFields(body, { partial: true });
  if (fields.kind !== undefined && fields.kind !== item.kind) invalid("kind cannot be changed");
  if (fields.parentId !== undefined && fields.parentId !== item.parentId) invalid("parentId cannot be changed");
  if (fields.position !== undefined && item.kind !== "lesson") invalid("position is only allowed for a lesson");
  Object.assign(item, fields, { updatedAt: iso(now()) });
  audit(admin, "content.update", item.id);
  return { status: 200, body: publicContent(item) };
});

route("POST", "/v1/admin/content/:id/upload-session", ({ req, params }) => {
  const admin = requireAdmin(req);
  const item = findContent(params.id);
  if (item.kind === "course") invalid("a course has no video; upload videos to its lessons");
  const providerAssetId = `fake-${randomBytes(8).toString("hex")}`;
  const asset = { id: randomUUID(), processingStatus: "awaiting_upload" };
  item.asset = asset;
  item.providerAssetId = providerAssetId;
  item.updatedAt = iso(now());
  uploads.set(providerAssetId, { contentId: item.id, assetId: asset.id });
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_URL_TTL_SECONDS;
  const uploadUrl = `${PUBLIC_BASE_URL}/v1/dev/media/uploads/${providerAssetId}?exp=${exp}&sig=${signUpload(providerAssetId, String(exp))}`;
  audit(admin, "content.upload_session", item.id);
  return {
    status: 201,
    body: {
      videoAssetId: asset.id,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      expiresAt: iso(new Date(exp * 1000)),
    },
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

// Fake media upload: a PUT with any body to a correctly signed, unexpired URL marks the asset ready.
route("PUT", "/v1/dev/media/uploads/:providerAssetId", async ({ req, params, query }) => {
  const upload = uploads.get(params.providerAssetId);
  if (!upload || !verifyUploadSignature(params.providerAssetId, query.get("exp"), query.get("sig"))) {
    await drain(req);
    fail(401, "INVALID_SIGNATURE", "Upload URL signature is invalid or expired.");
  }
  await drain(req);
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
  rejectUnknownQuery(query, ["email", "page", "pageSize"]);
  const email = query.get("email");
  if (email === null || email.trim() === "") invalid("email should not be empty");
  const needle = email.trim().toLowerCase();
  const items = [...users.values()]
    .filter((entry) => entry.user.email.toLowerCase().includes(needle))
    .sort((a, b) => a.user.email.localeCompare(b.user.email))
    .map((entry) => ({ user: entry.user, subscription: entry.subscription }));
  return { status: 200, body: paginate(items, pageQuery(query)) };
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
  revokeFamiliesOf(entry.user.id);
  audit(admin, "user.sessions_revoke", entry.user.id);
  return { status: 204 };
});

route("POST", "/v1/admin/devices/:id/revoke", ({ req, params }) => {
  const admin = requireAdmin(req);
  const device = devices.get(params.id);
  if (!device) notFound("Device");
  revokeDeviceRecord(device);
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

// Test controls (not part of the API contract) ------------------------------------------------
// Used by e2e/session.spec.ts to simulate the API rejecting tokens; a real API answers 404 here.

route("GET", "/__mock/state", () => ({ status: 200, body: { mock: true } }));

route("POST", "/__mock/expire-access-tokens", () => {
  accessTokens.clear();
  return { status: 204 };
});

route("POST", "/__mock/revoke-all-sessions", () => {
  accessTokens.clear();
  for (const record of refreshTokens.values()) revokedFamilies.add(record.familyId);
  return { status: 204 };
});

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
        reject(new HttpError(400, "VALIDATION_FAILED", "Request body too large."));
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
        reject(new HttpError(400, "VALIDATION_FAILED", "Malformed JSON body."));
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
      send(res, status, { statusCode: error.statusCode, code: error.code, message: error.message }, cors);
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
