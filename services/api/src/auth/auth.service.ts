import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { AppException } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import { type Database, DRIZZLE } from '../database/database.types';
import { isUniqueViolation } from '../database/pg-errors';
import { type Role, type UserRow, users, userSessions } from '../database/schema';
import { toUserDto } from '../users/user.dto';
import type { AuthResponseDto, LoginDto, RefreshResponseDto, RegisterDto, TokensDto } from './auth.dto';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password';
import { hashRefreshToken, issueRefreshToken, rotateRefreshToken } from './refresh-tokens';
import { DrizzleRefreshSessionStore } from './session-store';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  sid: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  private get refreshTtlMs(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000;
  }

  /** Registration always creates a `viewer`; admins only come from the seed script. */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const passwordHash = await hashPassword(dto.password);
    const now = new Date();
    try {
      return await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email: dto.email,
            passwordHash,
            displayName: dto.displayName ?? null,
            role: 'viewer',
            accountStatus: 'active',
          })
          .returning();
        if (!user) throw new Error('User insert returned no row');
        const issued = await issueRefreshToken(new DrizzleRefreshSessionStore(tx), user.id, {
          now,
          ttlMs: this.refreshTtlMs,
        });
        const tokens = await this.buildTokens(user, issued.session.id, issued.refreshToken, issued.session.expiresAt, now);
        return { user: toUserDto(user), tokens };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException('EMAIL_TAKEN');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const [user] = await this.db.select().from(users).where(eq(users.email, dto.email)).limit(1);
    // Always run one scrypt verification so response time does not reveal registered emails.
    const passwordOk = await verifyPassword(dto.password, user?.passwordHash ?? (await getDummyPasswordHash()));
    if (!user || !passwordOk) {
      throw new AppException('INVALID_CREDENTIALS');
    }
    if (user.accountStatus !== 'active') {
      throw new AppException('ACCOUNT_INACTIVE');
    }
    const now = new Date();
    const issued = await issueRefreshToken(new DrizzleRefreshSessionStore(this.db), user.id, {
      now,
      ttlMs: this.refreshTtlMs,
    });
    const tokens = await this.buildTokens(user, issued.session.id, issued.refreshToken, issued.session.expiresAt, now);
    return { user: toUserDto(user), tokens };
  }

  async refresh(refreshToken: string): Promise<RefreshResponseDto> {
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      const store = new DrizzleRefreshSessionStore(tx);
      const rotation = await rotateRefreshToken(store, refreshToken, { now, ttlMs: this.refreshTtlMs });
      if (!rotation.ok) return { ok: false as const };
      const [user] = await tx.select().from(users).where(eq(users.id, rotation.session.userId)).limit(1);
      if (!user || user.accountStatus !== 'active') {
        await store.revokeFamily(rotation.session.familyId, now);
        return { ok: false as const };
      }
      return { ok: true as const, user, rotation };
    });
    if (!result.ok) {
      throw new AppException('INVALID_REFRESH_TOKEN');
    }
    const { user, rotation } = result;
    const tokens = await this.buildTokens(user, rotation.session.id, rotation.refreshToken, rotation.session.expiresAt, now);
    return { tokens };
  }

  /** Revokes the session family the refresh token belongs to. Unknown tokens are ignored. */
  async logout(refreshToken: string): Promise<void> {
    const now = new Date();
    const [session] = await this.db
      .select({ familyId: userSessions.familyId })
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, hashRefreshToken(refreshToken)))
      .limit(1);
    if (!session) return;
    await new DrizzleRefreshSessionStore(this.db).revokeFamily(session.familyId, now);
  }

  /**
   * Validates an access token for the bearer guard. The JWT must verify, its session must not be
   * revoked (logout and admin revocation take effect immediately) and its user must be active.
   */
  async authenticate(accessToken: string): Promise<AuthUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(accessToken, { algorithms: ['HS256'] });
    } catch {
      throw new AppException('UNAUTHENTICATED');
    }
    if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub) || typeof payload.sid !== 'string' || !UUID_RE.test(payload.sid)) {
      throw new AppException('UNAUTHENTICATED');
    }
    const [row] = await this.db
      .select({ id: users.id, role: users.role, accountStatus: users.accountStatus })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(eq(userSessions.id, payload.sid), eq(userSessions.userId, payload.sub), isNull(userSessions.revokedAt)))
      .limit(1);
    if (!row) {
      throw new AppException('UNAUTHENTICATED');
    }
    if (row.accountStatus !== 'active') {
      throw new AppException('ACCOUNT_INACTIVE');
    }
    return { id: row.id, role: row.role, accountStatus: row.accountStatus, sessionId: payload.sid };
  }

  private async buildTokens(
    user: Pick<UserRow, 'id' | 'role'>,
    sessionId: string,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
    now: Date,
  ): Promise<TokensDto> {
    const ttlSeconds = this.config.get('ACCESS_TOKEN_TTL_SECONDS');
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, sid: sessionId };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: ttlSeconds, algorithm: 'HS256' });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    };
  }
}
