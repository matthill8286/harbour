import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // After the app is created, so values from .env files are loaded.
  configureApp(app);
  const port = Number(process.env.PORT ?? 3001);
  // Containers set HOST=0.0.0.0 so the reverse proxy can reach the API.
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}

void bootstrap();
