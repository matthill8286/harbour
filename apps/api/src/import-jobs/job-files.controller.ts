import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { STAFF_ROLES } from '@vip/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { documentUpload, photoUpload, requireUpload } from '../common/upload';
import { UpdateFileVisibilityDto } from './dto/import-job.dto';
import { JobFilesService, type PhotoSize } from './job-files.service';

const photoSize = (value?: string): PhotoSize =>
  value === 'thumb' || value === 'original' ? value : 'display';

/** The photos and documents of a job, for staff. */
@Controller('import-jobs/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
export class JobFilesController {
  constructor(private readonly files: JobFilesService) {}

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', documentUpload))
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type?: unknown,
    @Body('customerVisible') customerVisible?: string,
  ) {
    return this.files.addDocument(
      user,
      id,
      requireUpload(file),
      customerVisible === 'true',
      type,
    );
  }

  @Post('photos')
  @UseInterceptors(FileInterceptor('file', photoUpload))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: unknown,
    @Body('customerVisible') customerVisible?: string,
  ) {
    return this.files.addPhoto(
      user,
      id,
      requireUpload(file),
      customerVisible === 'true',
      category,
    );
  }

  @Get('documents/:fileId')
  downloadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.downloadDocument(user, id, fileId);
  }

  @Get('photos/:fileId')
  downloadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('size') size?: string,
  ) {
    return this.files.viewPhoto(user, id, fileId, photoSize(size));
  }

  @Patch('documents/:fileId')
  setDocumentVisibility(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdateFileVisibilityDto,
  ) {
    return this.files.setVisibility(
      user,
      id,
      'document',
      fileId,
      dto.customerVisible,
    );
  }

  @Patch('photos/:fileId')
  setPhotoVisibility(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Body() dto: UpdateFileVisibilityDto,
  ) {
    return this.files.setVisibility(
      user,
      id,
      'photo',
      fileId,
      dto.customerVisible,
    );
  }

  @Delete('documents/:fileId')
  @HttpCode(204)
  deleteDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.delete(user, id, 'document', fileId);
  }

  @Delete('photos/:fileId')
  @HttpCode(204)
  deletePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.delete(user, id, 'photo', fileId);
  }
}
