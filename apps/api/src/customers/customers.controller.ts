import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { LimitInviteSending } from '../rate-limit/rate-limit.guard';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.customers.list(user, search);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customers.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user, id, dto);
  }

  @Post(':id/invite')
  @LimitInviteSending()
  invite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customers.invite(user, id);
  }
}
