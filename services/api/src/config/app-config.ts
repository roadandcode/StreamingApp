import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Typed access to the validated environment (see env.schema.ts). */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** Playback sessions without a heartbeat for this long no longer count as active. */
  get playbackStaleAfterSeconds(): number {
    return this.get('PLAYBACK_HEARTBEAT_INTERVAL_SECONDS') * 3;
  }
}
