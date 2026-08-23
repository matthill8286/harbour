import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PortalService } from './portal.service';

@Controller('portal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('jobs')
  list(@CurrentUser() user: AuthUser) {
    return this.portal.list(user);
  }

  @Get('jobs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.portal.get(user, id);
  }

  @Get('jobs/:id/documents/:fileId')
  async downloadDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    const file = await this.portal.readVisibleFile(user, id, 'document', fileId);
    return this.portal.toStream(file);
  }

  @Get('jobs/:id/photos/:fileId')
  async downloadPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    const file = await this.portal.readVisibleFile(user, id, 'photo', fileId);
    return this.portal.toStream(file);
  }
}
