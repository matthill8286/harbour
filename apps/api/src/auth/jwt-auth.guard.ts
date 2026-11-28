import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from './auth.types';
import { ALLOW_WITHOUT_TWO_FACTOR } from './two-factor/allow-without-two-factor.decorator';
import { mustSetUpTwoFactor } from './two-factor/two-factor-policy';
import { ALLOW_WHEN_READ_ONLY } from './allow-when-read-only.decorator';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = (await super.canActivate(context)) as boolean;
    if (!allowed) return false;
    const allowWithout = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WITHOUT_TWO_FACTOR,
      [context.getHandler(), context.getClass()],
    );
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; user?: AuthUser }>();
    if (!allowWithout && request.user && mustSetUpTwoFactor(request.user)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'two_factor_required',
        message: 'Set up two-factor sign-in to continue',
      });
    }
    if (
      request.user?.workspaceReadOnly &&
      !READS.has(request.method ?? '') &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_READ_ONLY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'workspace_read_only',
        message:
          'This workspace is read-only because its plan has ended. You can still view and export your data.',
      });
    }
    return true;
  }
}
