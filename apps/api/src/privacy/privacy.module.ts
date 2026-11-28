import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerErasureService } from './customer-erasure.service';
import { CustomerExportService } from './customer-export.service';
import { ErasureJournal } from './erasure-journal';
import { PrivacyController } from './privacy.controller';
import { WorkspaceExportController } from './workspace-export.controller';
import { WorkspaceExportService } from './workspace-export.service';

@Module({
  imports: [AuthModule],
  controllers: [PrivacyController, WorkspaceExportController],
  providers: [
    CustomerErasureService,
    CustomerExportService,
    ErasureJournal,
    WorkspaceExportService,
  ],
})
export class PrivacyModule {}
