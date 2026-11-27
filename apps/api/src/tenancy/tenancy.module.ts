import { Global, Module } from '@nestjs/common';
import { FeaturesService } from './features.service';
import { UsageService } from './usage.service';

@Global()
@Module({
  providers: [UsageService, FeaturesService],
  exports: [UsageService, FeaturesService],
})
export class TenancyModule {}
