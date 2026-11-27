import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { ApiExceptionFilter } from './logging/api-exception.filter';
import type { ErrorReporter } from './logging/error-reporter';
import { requestLog, requestScope } from './logging/request-context';

/** The only route that takes large bodies: Flespi sends GPS messages in batches. */
export const FLESPI_WEBHOOK_PATH = '/api/integrations/gps/flespi';
export const FLESPI_BODY_LIMIT = '2mb';
export const BODY_LIMIT = '100kb';

/**
 * How many proxies stand in front of the API. Production has exactly one, the
 * Caddy edge, which sets X-Forwarded-For to the address that connected to it.
 * Express then reads only the last entry, so a caller cannot choose their own.
 * Without a proxy the header is the caller's to write, so it is ignored.
 */
export function trustedProxyHops(env: NodeJS.ProcessEnv): number {
  const configured = env.TRUST_PROXY_HOPS?.trim();
  if (configured && /^\d+$/.test(configured)) return Number(configured);
  return env.NODE_ENV === 'production' ? 1 : 0;
}

/** Production answers only the web app's own address. */
export function corsOrigins(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (env.NODE_ENV === 'production') return configured;
  return [...configured, 'http://localhost:5173', 'http://127.0.0.1:5173'];
}

/** Create the app with `bodyParser: false`, so the limits here are the only ones. */
export function configureApp(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
  options: { errorReporter?: ErrorReporter } = {},
) {
  app.disable('x-powered-by');
  app.set('trust proxy', trustedProxyHops(env));
  app.setGlobalPrefix('api');
  // Before the parsers, so a request they refuse is logged too.
  app.use(requestLog());
  // First of the parsers, because a body that has been read is not read again.
  app.use(FLESPI_WEBHOOK_PATH, json({ limit: FLESPI_BODY_LIMIT }));
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(requestScope);
  app.enableCors({ origin: corsOrigins(env), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // No implicit conversion: it reads the string "false" as true. A field
      // that arrives as text, such as a query number, says how to convert it.
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new ApiExceptionFilter(app.getHttpAdapter(), options.errorReporter),
  );
}
