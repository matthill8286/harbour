import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export type TrackedRequest = Request & {
  requestId?: string;
  user?: { id?: string; organisationId?: string };
};

/** The request being handled, so every line logged while handling it names it. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * The route's pattern, such as `/api/auth/invites/:token`. The path itself is
 * never logged: some paths carry an invite, sign-up or reset token.
 */
export function routePattern(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : 'unmatched';
}

/**
 * Names the request and writes one line when it ends. Install it first, so a
 * request refused while its body is read is logged too.
 */
export function requestLog(logger = new Logger('Request')) {
  return (request: TrackedRequest, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = process.hrtime.bigint();
    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.once('close', () => {
      const route = routePattern(request);
      const status = response.statusCode;
      // The uptime check asks every few minutes, and the logs are capped.
      if (route === '/api/health' && status < 400) return;
      const line = {
        msg: 'request',
        requestId,
        method: request.method,
        route,
        status,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        ...(response.writableFinished ? {} : { aborted: true }),
        // Internal ids, never a name or an email address.
        ...(request.user?.id ? { userId: request.user.id } : {}),
        ...(request.user?.organisationId
          ? { organisationId: request.user.organisationId }
          : {}),
      };
      if (status >= 500) logger.warn(line);
      else logger.log(line);
    });
    next();
  };
}

/**
 * Install after the body parsers. They continue from the socket's events, where
 * a context entered earlier is lost.
 */
export function requestScope(
  request: TrackedRequest,
  _response: Response,
  next: NextFunction,
) {
  storage.run({ requestId: request.requestId ?? randomUUID() }, next);
}
