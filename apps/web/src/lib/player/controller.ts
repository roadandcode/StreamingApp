import { defaultMessageForCode, parseErrorBody, userMessage } from "@/lib/api/errors";
import type { HeartbeatResponse, PlaybackAuthorization } from "@/lib/api/types";
import { buildPlayerSetup, createLicenseRequestFilter, detectSupportedDrm } from "./drm";

/**
 * Browser playback session lifecycle (client only):
 *
 * start → detect DRM → create session (our route handler → API) → load Shaka → heartbeats.
 *
 * Rules from the API contract: the server authorizes every playback; any 403 stops the player
 * immediately; a heartbeat after the session went stale (tab hidden for long) gets
 * `403 PLAYBACK_SESSION_ENDED`, and only in that resume case do we open a new session.
 *
 * Manifest URLs and licence headers are secrets: never log them or put them in error messages.
 */

type ShakaNamespace = typeof import("shaka-player").default;
type ShakaPlayer = InstanceType<ShakaNamespace["Player"]>;

export type PlayerState =
  | { kind: "starting" }
  | { kind: "playing" }
  | { kind: "paused-hidden" }
  | { kind: "resuming" }
  | { kind: "stopped"; code: string; message: string; retryable: boolean };

export interface PlaybackControllerOptions {
  contentId: string;
  video: HTMLVideoElement;
  requireDrm: boolean;
  maxVideoHeight: number;
  onState: (state: PlayerState) => void;
  /** Stop heartbeats (and pause) after the tab has been hidden this long. */
  hiddenPauseMs?: number;
}

type HeartbeatOutcome =
  | { kind: "ok"; expiresAt: string }
  | { kind: "forbidden"; code: string; message: string }
  | { kind: "unauthenticated" }
  | { kind: "network" };

const DEFAULT_HIDDEN_PAUSE_MS = 5 * 60 * 1000;
const RETRYABLE = new Set(["CONCURRENT_STREAM_LIMIT", "NETWORK_ERROR", "MEDIA_ERROR", "PLAYBACK_SESSION_ENDED", "UNKNOWN_ERROR"]);

class StartError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function loadShaka(): Promise<ShakaNamespace> {
  const mod = (await import("shaka-player")) as unknown as { default?: ShakaNamespace } & ShakaNamespace;
  return mod.default ?? mod;
}

export class PlaybackController {
  private readonly options: PlaybackControllerOptions;
  private readonly hiddenPauseMs: number;
  private disposed = false;
  private session: PlaybackAuthorization | null = null;
  private sessionEnded = true;
  private expiresAt = 0;
  private shaka: ShakaNamespace | null = null;
  private player: ShakaPlayer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInFlight = false;
  private heartbeatsPaused = false;
  private hiddenSince: number | null = null;
  private generation = 0;

  constructor(options: PlaybackControllerOptions) {
    this.options = options;
    this.hiddenPauseMs = options.hiddenPauseMs ?? DEFAULT_HIDDEN_PAUSE_MS;
  }

  /** Begins playback; also used by "Try again" after a stop. */
  async start(resumeAt?: number): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.teardownPlayback();
    this.attachListeners();
    this.options.onState({ kind: "starting" });

    try {
      const supportedDrm = await detectSupportedDrm(
        typeof navigator.requestMediaKeySystemAccess === "function"
          ? navigator.requestMediaKeySystemAccess.bind(navigator)
          : undefined,
      );
      if (this.isStale(generation)) return;

      const authorization = await this.createSession(supportedDrm);
      if (this.isStale(generation)) {
        this.endSessionById(authorization.playbackSessionId);
        return;
      }
      this.session = authorization;
      this.sessionEnded = false;
      this.expiresAt = Date.parse(authorization.expiresAt) || Date.now();

      // Defence in depth: the route handler already refuses `drm: null` when REQUIRE_DRM is on.
      const setup = buildPlayerSetup(authorization.drm, {
        requireDrm: this.options.requireDrm,
        maxVideoHeight: this.options.maxVideoHeight,
      });
      if (!setup.ok) {
        throw new StartError("DRM_REQUIRED", defaultMessageForCode("DRM_REQUIRED"));
      }

      this.startHeartbeats(authorization.heartbeatIntervalSeconds);

      const shaka = this.shaka ?? (this.shaka = await loadShaka());
      if (this.isStale(generation)) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        throw new StartError("BROWSER_UNSUPPORTED", "This browser cannot play our videos. Try the latest Chrome, Edge or Firefox.");
      }

      const player = new shaka.Player();
      this.player = player;
      await player.attach(this.options.video);
      player.configure(setup.config);
      if (setup.licenseRequestHeaders) {
        player
          .getNetworkingEngine()
          ?.registerRequestFilter(
            createLicenseRequestFilter(shaka.net.NetworkingEngine.RequestType.LICENSE, setup.licenseRequestHeaders),
          );
      }
      player.addEventListener("error", (event) => {
        if (this.player !== player) return; // a player we already replaced or destroyed
        const detail = (event as unknown as { detail?: { severity?: number; code?: number } }).detail;
        if (detail?.severity === shaka.util.Error.Severity.CRITICAL) this.mediaFailure(detail.code);
      });

      await player.load(authorization.manifestUrl, resumeAt);
      if (this.isStale(generation)) return;
      this.options.onState({ kind: "playing" });
      this.options.video.play().catch(() => {
        // Autoplay blocked: the viewer presses play.
      });
    } catch (error) {
      if (this.isStale(generation)) return;
      if (error instanceof StartError) {
        this.stop(error.code, error.message);
      } else {
        const code = (error as { code?: unknown } | null)?.code;
        this.mediaFailure(typeof code === "number" ? code : undefined);
      }
    }
  }

  /** Called when the component unmounts (navigation away inside the app). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.teardownPlayback();
    this.detachListeners();
  }

  private isStale(generation: number): boolean {
    return this.disposed || generation !== this.generation;
  }

  private async createSession(supportedDrm: string[]): Promise<PlaybackAuthorization> {
    let response: Response;
    try {
      response = await fetch("/api/playback/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentId: this.options.contentId, supportedDrm }),
      });
    } catch {
      throw new StartError("NETWORK_ERROR", defaultMessageForCode("NETWORK_ERROR"));
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = parseErrorBody(response.status, body);
      throw new StartError(error.code, userMessage(error));
    }
    return body as PlaybackAuthorization;
  }

  private startHeartbeats(intervalSeconds: number): void {
    this.stopHeartbeats();
    this.heartbeatsPaused = false;
    const intervalMs = Math.max(1, intervalSeconds) * 1000;
    this.heartbeatTimer = setInterval(() => void this.tick(), intervalMs);
  }

  private stopHeartbeats(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.heartbeatInFlight || this.sessionEnded) return;
    if (this.hiddenSince !== null && Date.now() - this.hiddenSince >= this.hiddenPauseMs) {
      // Nobody is watching: stop holding a stream slot. The session goes stale on the server.
      this.stopHeartbeats();
      this.heartbeatsPaused = true;
      this.options.video.pause();
      this.options.onState({ kind: "paused-hidden" });
      return;
    }
    const sessionId = this.session?.playbackSessionId;
    const outcome = await this.sendHeartbeat();
    if (this.isCurrentSession(sessionId)) this.handleRegularOutcome(outcome);
  }

  /** False when the session changed or ended while a heartbeat was in flight. */
  private isCurrentSession(sessionId: string | undefined): boolean {
    return !this.disposed && !this.sessionEnded && sessionId !== undefined && this.session?.playbackSessionId === sessionId;
  }

  private handleRegularOutcome(outcome: HeartbeatOutcome): void {
    if (outcome.kind === "ok") return;
    if (outcome.kind === "forbidden") {
      // The API already ended or revoked the session: stop immediately.
      this.sessionEnded = true;
      this.stop(outcome.code, outcome.message);
    } else if (outcome.kind === "unauthenticated") {
      this.sessionEnded = true;
      this.stop("UNAUTHENTICATED", defaultMessageForCode("UNAUTHENTICATED"));
    } else if (Date.now() > this.expiresAt) {
      this.stop("NETWORK_ERROR", "Playback stopped because the connection was lost.");
    }
  }

  private async sendHeartbeat(): Promise<HeartbeatOutcome> {
    const session = this.session;
    if (!session) return { kind: "network" };
    this.heartbeatInFlight = true;
    try {
      const response = await fetch(`/api/playback/sessions/${session.playbackSessionId}/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionSeconds: Math.floor(this.options.video.currentTime || 0) }),
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (response.ok) {
        const expiresAt = (body as HeartbeatResponse | undefined)?.expiresAt;
        if (expiresAt) this.expiresAt = Date.parse(expiresAt) || this.expiresAt;
        return { kind: "ok", expiresAt: expiresAt ?? "" };
      }
      if (response.status === 401) return { kind: "unauthenticated" };
      if (response.status === 403) {
        const error = parseErrorBody(response.status, body);
        return { kind: "forbidden", code: error.code, message: userMessage(error) };
      }
      return { kind: "network" };
    } catch {
      return { kind: "network" };
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async resumeAfterHidden(): Promise<void> {
    if (!this.heartbeatsPaused || this.sessionEnded || !this.session) return;
    this.heartbeatsPaused = false;
    this.options.onState({ kind: "resuming" });
    const sessionId = this.session.playbackSessionId;
    const outcome = await this.sendHeartbeat();
    if (!this.isCurrentSession(sessionId) || !this.session) return;
    if (outcome.kind === "forbidden" && outcome.code === "PLAYBACK_SESSION_ENDED") {
      // The session went stale while hidden: open a new one and continue from the same position.
      this.sessionEnded = true;
      await this.start(this.options.video.currentTime || undefined);
      return;
    }
    if (outcome.kind === "ok" || outcome.kind === "network") {
      this.startHeartbeats(this.session.heartbeatIntervalSeconds);
      this.options.onState({ kind: "playing" });
      if (outcome.kind === "network") this.handleRegularOutcome(outcome);
      return;
    }
    this.handleRegularOutcome(outcome);
  }

  private mediaFailure(code?: number): void {
    // Shaka error details can contain signed URLs: show only the numeric code.
    this.stop("MEDIA_ERROR", `The video could not be played${code ? ` (error ${code})` : ""}. Please try again.`);
  }

  private stop(code: string, message: string): void {
    // Invalidate any start() still in flight so it cannot report "playing" after this.
    this.generation += 1;
    this.stopHeartbeats();
    this.endSession();
    this.heartbeatsPaused = false;
    this.options.video.pause();
    const player = this.player;
    this.player = null;
    if (player) void player.destroy().catch(() => undefined);
    this.options.video.removeAttribute("src");
    this.options.onState({ kind: "stopped", code, message, retryable: RETRYABLE.has(code) });
  }

  private teardownPlayback(): void {
    this.stopHeartbeats();
    this.endSession();
    const player = this.player;
    this.player = null;
    if (player) void player.destroy().catch(() => undefined);
  }

  /** Ends the current session at the API (best effort, survives page unload). */
  private endSession(): void {
    if (!this.session || this.sessionEnded) return;
    this.sessionEnded = true;
    this.endSessionById(this.session.playbackSessionId);
  }

  private endSessionById(id: string): void {
    const url = `/api/playback/sessions/${encodeURIComponent(id)}/end`;
    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url);
    if (!sent) void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.hiddenSince ??= Date.now();
    } else {
      this.hiddenSince = null;
      void this.resumeAfterHidden();
    }
  };

  private onPageHide = (): void => {
    this.stopHeartbeats();
    this.endSession();
  };

  private onPageShow = (event: PageTransitionEvent): void => {
    // Restored from the back/forward cache after we ended the session on pagehide.
    if (event.persisted && this.sessionEnded && !this.disposed) void this.start(this.options.video.currentTime || undefined);
  };

  private listenersAttached = false;

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
  }
}
