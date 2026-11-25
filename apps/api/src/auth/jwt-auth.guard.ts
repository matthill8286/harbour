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
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!allowWithout && request.user && mustSetUpTwoFactor(request.user)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'two_factor_required',
        message: 'Set up two-factor sign-in to continue',
      });
    }
    return true;
  }
}
