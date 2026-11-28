import { Module } from '@nestjs/common';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { TermsService } from './terms.service';

@Module({
  controllers: [OrganisationsController],
  providers: [OrganisationsService, TermsService],
})
export class OrganisationsModule {}
