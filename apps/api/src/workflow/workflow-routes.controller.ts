import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { WorkflowRoutesService } from './workflow-routes.service';
import {
  CreateRouteDto,
  RemoveStageDto,
  ReorderStagesDto,
  SaveStageDto,
  UpdateRouteDto,
} from './dto/route.dto';

/** Routes and their stages. Everyone on the team reads them; owners and admins change them. */
@Controller('routes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowRoutesController {
  constructor(private readonly routes: WorkflowRoutesService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  list(@CurrentUser() user: AuthUser) {
    return this.routes.list(user);
  }

  @Post()
  @Roles('ADMIN')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRouteDto) {
    return this.routes.create(user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routes.update(user, id, dto);
  }

  @Post(':id/stages')
  @Roles('ADMIN')
  addStage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SaveStageDto,
  ) {
    return this.routes.addStage(user, id, dto);
  }

  @Put(':id/stages/order')
  @Roles('ADMIN')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReorderStagesDto,
  ) {
    return this.routes.reorderStages(user, id, dto);
  }

  @Put(':id/stages/:stageId')
  @Roles('ADMIN')
  saveStage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: SaveStageDto,
  ) {
    return this.routes.saveStage(user, id, stageId, dto);
  }

  @Delete(':id/stages/:stageId')
  @Roles('ADMIN')
  removeStage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Query() query: RemoveStageDto,
  ) {
    return this.routes.removeStage(user, id, stageId, query.moveTo);
  }
}
