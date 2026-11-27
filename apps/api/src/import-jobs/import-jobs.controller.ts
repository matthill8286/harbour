import {
  Body,
  Controller,
  Delete,
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
import { ImportJobsService } from './import-jobs.service';
import {
  ChangeStatusDto,
  CreateChargeDto,
  CreateCostDto,
  CreateImportJobDto,
  CreateJourneyDto,
  CreateNoteDto,
  CreateTaskDto,
  DraftCustomerNoteDto,
  UpdateChargeDto,
  UpdateCostDto,
  UpdateImportJobDto,
  UpdateTaskDto,
} from './dto/import-job.dto';

@Controller('import-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class ImportJobsController {
  constructor(private readonly jobs: ImportJobsService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.jobs.list(user, { status, search });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateImportJobDto) {
    return this.jobs.create(user, dto);
  }

  @Get(':id/activity')
  @Roles(...STAFF_ROLES)
  activity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.activity(user, id);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateImportJobDto,
  ) {
    return this.jobs.update(user, id, dto);
  }

  @Post(':id/route-recommend')
  @Roles(...STAFF_ROLES)
  recommendRoute(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.recommendRoute(user, id);
  }

  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.jobs.changeStatus(user, id, dto);
  }

  @Post(':id/tasks')
  addTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.jobs.addTask(user, id, dto);
  }

  @Patch(':id/tasks/:taskId')
  updateTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.jobs.updateTask(user, id, taskId, dto);
  }

  @Post(':id/costs')
  addCost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateCostDto,
  ) {
    return this.jobs.addCost(user, id, dto);
  }

  @Post(':id/charges')
  addCharge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateChargeDto,
  ) {
    return this.jobs.addCharge(user, id, dto);
  }

  @Patch(':id/costs/:costId')
  updateCost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('costId') costId: string,
    @Body() dto: UpdateCostDto,
  ) {
    return this.jobs.updateCost(user, id, costId, dto);
  }

  @Delete(':id/costs/:costId')
  deleteCost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('costId') costId: string,
  ) {
    return this.jobs.deleteCost(user, id, costId);
  }

  @Patch(':id/charges/:chargeId')
  updateCharge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @Body() dto: UpdateChargeDto,
  ) {
    return this.jobs.updateCharge(user, id, chargeId, dto);
  }

  @Delete(':id/charges/:chargeId')
  deleteCharge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
  ) {
    return this.jobs.deleteCharge(user, id, chargeId);
  }

  @Post(':id/draft-customer-note')
  draftCustomerNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DraftCustomerNoteDto,
  ) {
    return this.jobs.draftCustomerNote(user, id, dto);
  }

  @Post(':id/notes')
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.jobs.addNote(user, id, dto);
  }

  @Post(':id/journeys')
  addJourney(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateJourneyDto,
  ) {
    return this.jobs.addJourney(user, id, dto);
  }
}
