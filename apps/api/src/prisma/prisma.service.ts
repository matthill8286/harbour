import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    const attempts = 15;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        this.logger.warn(
          `Database not ready (attempt ${attempt}/${attempts}). Start Postgres with docker compose up -d`,
        );
        if (attempt === attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
