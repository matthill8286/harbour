import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerErasureService } from './customer-erasure.service';
import { CustomerExportService } from './customer-export.service';
import { ErasureJournal } from './erasure-journal';
import { PrivacyController } from './privacy.controller';

@Module({
  imports: [AuthModule],
  controllers: [PrivacyController],
  providers: [CustomerErasureService, CustomerExportService, ErasureJournal],
})
export class PrivacyModule {}
