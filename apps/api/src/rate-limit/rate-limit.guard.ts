import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { rateLimitAddress } from './client-ip';
import type { RateLimitPolicy } from './policies';
import { RateLimiter, TooManyRequestsException } from './rate-limiter';

const REQUEST_LIMITS = 'harbour:request-limits';

/** What a limit applied to a request counts by. */
export type RequestLimit = {
  policy: RateLimitPolicy;
  by: 'ip' | 'user' | 'organisation';
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const limits =
      this.reflector.get<RequestLimit[]>(
        REQUEST_LIMITS,
        context.getHandler(),
      ) ?? [];
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthUser }>();
    try {
      // In order, so a caller stopped by their address uses up nothing else.
      for (const { policy, by } of limits) {
        this.limiter.consume(policy, keyFor(by, request));
      }
    } catch (error) {
      if (error instanceof TooManyRequestsException) {
        http
          .getResponse<Response>()
          .setHeader('Retry-After', error.retryAfterSeconds);
      }
      throw error;
    }
    return true;
  }
}

function keyFor(
  by: RequestLimit['by'],
  request: Request & { user?: AuthUser },
) {
  // `request.ip` follows the trust proxy setting in app.setup.ts.
  if (by === 'ip') return rateLimitAddress(request.ip);
  // The user and organisation limits go on routes that are already signed in.
  return by === 'user' ? request.user!.id : request.user!.organisationId;
}

/** Limits one route. List it after any guard that signs the user in. */
export function RateLimit(...limits: RequestLimit[]) {
  return applyDecorators(
    SetMetadata(REQUEST_LIMITS, limits),
    UseGuards(RateLimitGuard),
  );
}

/** The limits on every route that sends an invite. */
export const LimitInviteSending = () =>
  RateLimit(
    { policy: 'inviteSendIp', by: 'ip' },
    { policy: 'inviteSendUser', by: 'user' },
    { policy: 'inviteSendOrganisation', by: 'organisation' },
  );
