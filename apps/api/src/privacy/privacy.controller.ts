import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AllowWhenReadOnly } from '../auth/allow-when-read-only.decorator';
import { TwoFactorService } from '../auth/two-factor/two-factor.service';
import type { AuthUser } from '../auth/auth.types';
import { RateLimit } from '../rate-limit/rate-limit.guard';
import { CustomerErasureService } from './customer-erasure.service';
import { CustomerExportService } from './customer-export.service';
import { EraseCustomerDto, ReviewDecisionDto } from './privacy.dto';

/**
 * A customer's rights over their data. Admins only. A lapsed plan blocks none
 * of it.
 */
@Controller('customers/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@AllowWhenReadOnly()
export class PrivacyController {
  constructor(
    private readonly erasures: CustomerErasureService,
    private readonly exports: CustomerExportService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Get('export')
  export(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exports.export(user, id);
  }

  @Get('erasure/preview')
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.erasures.preview(user, id);
  }

  @Get('erasure')
  status(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.erasures.status(user, id);
  }

  @Post('erasure')
  @HttpCode(200)
  @RateLimit({ policy: 'twoFactorIp', by: 'ip' })
  async erase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EraseCustomerDto,
  ) {
    await this.erasures.assertCanErase(user, id, dto.confirmation);
    await this.twoFactor.confirmIdentity(user.id, dto.password, dto);
    return this.erasures.erase(user, id, dto.confirmation);
  }

  @Post('erasure/review/:itemId')
  @HttpCode(200)
  @RateLimit({ policy: 'twoFactorIp', by: 'ip' })
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    if (dto.decision === 'REMOVE') {
      if (!dto.password) {
        throw new BadRequestException('Enter your password.');
      }
      await this.twoFactor.confirmIdentity(user.id, dto.password, dto);
    }
    return this.erasures.decide(user, id, itemId, dto.decision);
  }
}
