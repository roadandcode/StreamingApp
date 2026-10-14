import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../common/errors';
import { type AppRequest, IS_PUBLIC_KEY, ROLES_KEY } from '../common/request-context';
import type { Role } from '../database/schema';
import { AuthService } from './auth.service';

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9\-_.]+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/** Global guard: every route needs a valid bearer token unless marked `@Public()`. */
@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new AppException('UNAUTHENTICATED');
    }
    request.user = await this.auth.authenticate(token);
    return true;
  }
}

/** Global guard: enforces `@Roles(...)` using the role read from the database by the bearer guard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (!request.user || !roles.includes(request.user.role)) {
      throw new AppException('FORBIDDEN');
    }
    return true;
  }
}
