import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VehicleCapabilities } from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleDataService } from '../integrations/vehicle-data.service';
import { AnprService } from '../integrations/anpr.service';
import { sampleDataAllowed } from '../integrations/sample-data';
import type { AuthUser } from '../auth/auth.types';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicleData: VehicleDataService,
    private readonly anpr: AnprService,
    private readonly config: ConfigService,
  ) {}

  list(user: AuthUser, search?: string) {
    return this.prisma.vehicle.findMany({
      where: {
        organisationId: user.organisationId,
        ...(search
          ? {
              OR: [
                { vin: { contains: search, mode: 'insensitive' } },
                { make: { contains: search, mode: 'insensitive' } },
                { model: { contains: search, mode: 'insensitive' } },
                { ukRegistration: { contains: search, mode: 'insensitive' } },
                {
                  cyprusRegistration: { contains: search, mode: 'insensitive' },
                },
              ],
            }
          : {}),
      },
      include: {
        importJobs: {
          select: { id: true, reference: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, organisationId: user.organisationId },
      include: {
        registrations: { orderBy: { issuedAt: 'desc' } },
        importJobs: {
          include: { customer: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  /** What the new-job screen can offer this workspace. */
  async capabilities(user: AuthUser): Promise<VehicleCapabilities> {
    const sampleAllowed = await this.sampleAllowed(user);
    return {
      lookup: this.vehicleData.available(sampleAllowed),
      scan: this.anpr.available(sampleAllowed),
    };
  }

  async lookup(user: AuthUser, registration: string) {
    return this.vehicleData.lookup(
      registration,
      await this.sampleAllowed(user),
    );
  }

  async scanPlate(user: AuthUser, file: Express.Multer.File) {
    return this.anpr.recognise(
      {
        originalName: file.originalname,
        buffer: file.buffer,
        mimeType: file.mimetype,
      },
      await this.sampleAllowed(user),
    );
  }

  private async sampleAllowed(user: AuthUser) {
    const organisation = await this.prisma.organisation.findUnique({
      where: { id: user.organisationId },
      select: { slug: true },
    });
    return sampleDataAllowed(
      this.config.get<string>('NODE_ENV'),
      organisation?.slug,
    );
  }

  create(user: AuthUser, dto: CreateVehicleDto) {
    return this.prisma.vehicle.create({
      data: {
        organisationId: user.organisationId,
        ...dto,
        registrations: dto.ukRegistration
          ? {
              create: {
                organisationId: user.organisationId,
                kind: 'UK',
                number: dto.ukRegistration,
                country: dto.countryOfRegistration ?? 'GB',
              },
            }
          : undefined,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateVehicleDto) {
    await this.get(user, id);
    return this.prisma.vehicle.update({ where: { id }, data: dto });
  }
}
