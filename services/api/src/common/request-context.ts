import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AccountStatus, Role } from '../database/schema';

/** The authenticated caller, attached to the request by the bearer guard. */
export interface AuthUser {
  id: string;
  role: Role;
  accountStatus: AccountStatus;
  sessionId: string;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  viewerCountry?: string;
}

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route (or controller) as not requiring a bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restricts a route (or controller) to the given roles; others get `403 FORBIDDEN`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated caller. Only valid on routes behind the bearer guard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<AppRequest>();
  if (!request.user) {
    throw new Error('CurrentUser used on a route without authentication');
  }
  return request.user;
});

/** Injects the viewer's ISO-3166 alpha-2 country resolved by the country middleware. */
export const ViewerCountry = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AppRequest>();
  if (!request.viewerCountry) {
    throw new Error('Viewer country was not resolved for this request');
  }
  return request.viewerCountry;
});
