import type { ErrorDetails } from './redact';

export type ErrorReport = {
  /** Already redacted: send this, never the error object itself. */
  error: ErrorDetails;
  requestId?: string;
  method?: string;
  route?: string;
};

/**
 * Where unexpected errors go besides the logs. To add an error tracking service,
 * implement this and pass it to `configureApp` and `reportFatalErrors` in
 * main.ts. The options are in apps/api/README.md.
 */
export interface ErrorReporter {
  report(report: ErrorReport): void;
}

/** The default. The error is already in the logs. */
export const noErrorReporter: ErrorReporter = { report: () => undefined };
