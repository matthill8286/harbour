import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class FlespiWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const expected =
      this.config.get<string>('FLESPI_WEBHOOK_SECRET')?.trim() ?? '';
    if (!expected) {
      throw new ServiceUnavailableException('Flespi webhook is not configured');
    }
    const request = context.switchToHttp().getRequest<Request>();
    const provided = providedSecret(request);
    if (!provided || !secretsMatch(provided, expected)) {
      throw new UnauthorizedException('Invalid GPS webhook secret');
    }
    return true;
  }
}

export function providedSecret(request: Request) {
  const header = request.header('x-harbour-gps-secret');
  if (header) return header.trim();
  const authorization = request.header('authorization') ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1]?.trim() ?? '';
}

export function secretsMatch(provided: string, expected: string) {
  const left = createHash('sha256').update(provided).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}
