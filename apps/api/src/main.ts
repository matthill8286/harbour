import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: false });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [
      process.env.WEB_ORIGIN ?? 'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = Number(process.env.PORT ?? 3001);
  // Containers set HOST=0.0.0.0 so the reverse proxy can reach the API.
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}

void bootstrap();
