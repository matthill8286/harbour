import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { ImportJobsModule } from './import-jobs/import-jobs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TrackersModule } from './trackers/trackers.module';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    AuditModule,
    IntegrationsModule,
    AuthModule,
    CustomersModule,
    VehiclesModule,
    ImportJobsModule,
    DashboardModule,
    TrackersModule,
    TrackingModule,
  ],
})
export class AppModule {}
