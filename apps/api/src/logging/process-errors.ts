import { Logger } from '@nestjs/common';
import { noErrorReporter, type ErrorReporter } from './error-reporter';
import { describeError } from './redact';

/**
 * An error nothing caught still stops the process, as it does by default, and
 * Docker starts it again. This writes it as one redacted line first.
 */
export function reportFatalErrors(
  reporter: ErrorReporter = noErrorReporter,
  target: NodeJS.Process = process,
) {
  const logger = new Logger('Process');
  const stop = (error: unknown) => {
    const details = describeError(error);
    logger.fatal({ msg: 'Stopping after an uncaught error', error: details });
    try {
      reporter.report({ error: details });
    } finally {
      target.exit(1);
    }
  };
  target.on('uncaughtException', stop);
  target.on('unhandledRejection', stop);
}
