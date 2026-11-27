import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PortalService } from './portal.service';
import { UpdateOwnDetailsDto } from './portal.dto';

@Controller('portal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.portal.me(user);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateOwnDetailsDto) {
    return this.portal.updateMe(user, dto);
  }

  @Get('jobs')
  list(@CurrentUser() user: AuthUser) {
    return this.portal.list(user);
  }

  @Get('jobs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.portal.get(user, id);
  }

  @Get('jobs/:id/documents/:fileId')
  downloadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.portal.downloadDocument(user, id, fileId);
  }

  @Get('jobs/:id/photos/:fileId')
  downloadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('size') size?: string,
  ) {
    // There is no way to ask for the original, which can say where it was taken.
    return this.portal.viewPhoto(
      user,
      id,
      fileId,
      size === 'thumb' ? 'thumb' : 'display',
    );
  }
}
