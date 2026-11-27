import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpServer,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { noErrorReporter, type ErrorReporter } from './error-reporter';
import { prismaProblem } from './prisma-errors';
import { describeError } from './redact';
import { routePattern, type TrackedRequest } from './request-context';

/**
 * Every error answer. The errors Harbour throws on purpose go out as written.
 * Database errors become a plain 4xx or 503. Anything else is a 500 that says
 * nothing about the cause, with the request ID to find it in the logs.
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  private readonly log = new Logger('Errors');

  constructor(
    private readonly adapter: HttpServer,
    private readonly reporter: ErrorReporter = noErrorReporter,
  ) {
    super(adapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException) {
      if (exception.getStatus() >= 500) {
        this.log.warn({
          msg: exception.message,
          status: exception.getStatus(),
        });
      }
      super.catch(exception, host);
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<TrackedRequest>();
    const response = http.getResponse<Response>();

    const problem = prismaProblem(exception);
    if (problem) {
      const { name, code, model } = describeError(exception);
      this.log.warn({
        msg: 'Database refused a request',
        status: problem.status,
        name,
        ...(code ? { code } : {}),
        ...(model ? { model } : {}),
      });
      this.answer(response, problem.status, { message: problem.message });
      return;
    }

    // The body parsers' errors, such as a body that is too large. They can hold
    // the body, so they are not logged.
    const refused = clientError(exception);
    if (refused) {
      this.answer(response, refused.status, { message: refused.message });
      return;
    }

    const details = describeError(exception);
    this.log.error({ msg: 'Unexpected error', error: details });
    try {
      this.reporter.report({
        error: details,
        requestId: request.requestId,
        method: request.method,
        route: routePattern(request),
      });
    } catch (error) {
      this.log.warn(
        `The error reporter failed: ${describeError(error).message}`,
      );
    }
    this.answer(response, HttpStatus.INTERNAL_SERVER_ERROR, {
      message: 'Internal server error',
      requestId: request.requestId,
    });
  }

  private answer(response: Response, status: number, body: object) {
    if (response.headersSent) {
      response.end();
      return;
    }
    this.adapter.reply(response, { statusCode: status, ...body }, status);
  }
}

/** An error from Express's own middleware that is the caller's fault. */
function clientError(error: unknown) {
  const { statusCode, expose, message } = (error ?? {}) as {
    statusCode?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  if (
    typeof statusCode !== 'number' ||
    statusCode < 400 ||
    statusCode >= 500 ||
    expose !== true
  ) {
    return undefined;
  }
  return { status: statusCode, message: String(message) };
}
