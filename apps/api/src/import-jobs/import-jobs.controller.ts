import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ImportJobsService } from './import-jobs.service';
import { documentUpload, photoUpload, requireUpload } from '../common/upload';
import {
  ChangeStatusDto,
  CreateChargeDto,
  CreateCostDto,
  CreateImportJobDto,
  CreateJourneyDto,
  CreateNoteDto,
  CreateTaskDto,
  UpdateFileVisibilityDto,
  UpdateImportJobDto,
  UpdateTaskDto,
} from './dto/import-job.dto';

@Controller('import-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
export class ImportJobsController {
  constructor(private readonly jobs: ImportJobsService) {}

  @Get()
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
  activity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.activity(user, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateImportJobDto) {
    return this.jobs.update(user, id, dto);
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
  addTask(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateTaskDto) {
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
  addCost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateCostDto) {
    return this.jobs.addCost(user, id, dto);
  }

  @Post(':id/charges')
  addCharge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateChargeDto) {
    return this.jobs.addCharge(user, id, dto);
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateNoteDto) {
    return this.jobs.addNote(user, id, dto);
  }

  @Post(':id/journeys')
  addJourney(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateJourneyDto) {
    return this.jobs.addJourney(user, id, dto);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', documentUpload))
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type?: string,
    @Body('customerVisible') customerVisible?: string,
  ) {
    return this.jobs.addDocument(user, id, requireUpload(file), customerVisible === 'true', type);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', photoUpload))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
    @Body('customerVisible') customerVisible?: string,
  ) {
    return this.jobs.addPhoto(user, id, requireUpload(file), customerVisible === 'true', category);
  }

  @Get(':id/documents/:fileId')
  async downloadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    const file = await this.jobs.readStoredFile(user, id, 'document', fileId);
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.name}"`,
    });
  }

  @Get(':id/photos/:fileId')
  async downloadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    const file = await this.jobs.readStoredFile(user, id, 'photo', fileId);
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `inline; filename="${file.name}"`,
    });
  }

  @Patch(':id/documents/:fileId')
  setDocumentVisibility(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdateFileVisibilityDto,
  ) {
    return this.jobs.setFileVisibility(user, id, 'document', fileId, dto.customerVisible);
  }

  @Patch(':id/photos/:fileId')
  setPhotoVisibility(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdateFileVisibilityDto,
  ) {
    return this.jobs.setFileVisibility(user, id, 'photo', fileId, dto.customerVisible);
  }
}
