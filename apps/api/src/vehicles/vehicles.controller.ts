import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { STAFF_READ_ROLES, STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { VehiclesService } from './vehicles.service';
import {
  CreateVehicleDto,
  LookupVehicleDto,
  UpdateVehicleDto,
} from './dto/vehicle.dto';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @Roles(...STAFF_READ_ROLES)
  list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.vehicles.list(user, search);
  }

  @Post('lookup')
  @Roles(...STAFF_READ_ROLES)
  lookup(@Body() dto: LookupVehicleDto) {
    return this.vehicles.lookup(dto.registration);
  }

  @Post('scan-plate')
  @Roles(...STAFF_READ_ROLES)
  @UseInterceptors(FileInterceptor('image'))
  scanPlate(@UploadedFile() file?: Express.Multer.File) {
    return this.vehicles.scanPlate(file);
  }

  @Get(':id')
  @Roles(...STAFF_READ_ROLES)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vehicles.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.update(user, id, dto);
  }
}
