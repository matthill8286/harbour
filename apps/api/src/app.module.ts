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
import { PortalModule } from './portal/portal.module';
import { TrackersModule } from './trackers/trackers.module';
import { TrackingModule } from './tracking/tracking.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    PrismaModule,
    TenancyModule,
    AuditModule,
    IntegrationsModule,
    AuthModule,
    CustomersModule,
    VehiclesModule,
    ImportJobsModule,
    DashboardModule,
    PortalModule,
    TrackersModule,
    TrackingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
