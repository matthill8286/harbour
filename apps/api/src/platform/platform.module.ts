import { Module } from '@nestjs/common';
import { ClosureEmailService } from './closure-email.service';

/** The parts of the operator's work that run inside the api. */
@Module({ providers: [ClosureEmailService] })
export class PlatformModule {}
