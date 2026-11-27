import { Global, Module } from '@nestjs/common';
import { FeaturesService } from './features.service';
import { UsageService } from './usage.service';
import { RoleConversionService } from './role-conversion.service';

@Global()
@Module({
  providers: [UsageService, FeaturesService, RoleConversionService],
  exports: [UsageService, FeaturesService],
})
export class TenancyModule {}
