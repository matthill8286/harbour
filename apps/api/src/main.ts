import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppLogger } from './logging/app-logger';
import { noErrorReporter } from './logging/error-reporter';
import { reportFatalErrors } from './logging/process-errors';

async function bootstrap() {
  // The place to plug in error tracking. See apps/api/README.md.
  const errorReporter = noErrorReporter;
  reportFatalErrors(errorReporter);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: new AppLogger(),
  });
  // After the app is created, so values from .env files are loaded.
  configureApp(app, process.env, { errorReporter });
  // On `docker stop`, finish the requests in hand and close the database. The
  // explicit exit matters: as a container's first process, Node would ignore the
  // signal Nest sends itself otherwise, and Docker would have to kill it.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
  const port = Number(process.env.PORT ?? 3001);
  // Containers set HOST=0.0.0.0 so the reverse proxy can reach the API.
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}

void bootstrap();
