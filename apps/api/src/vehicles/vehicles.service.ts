import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleDataService } from '../integrations/vehicle-data.service';
import { AnprService } from '../integrations/anpr.service';
import type { AuthUser } from '../auth/auth.types';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicleData: VehicleDataService,
    private readonly anpr: AnprService,
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

  lookup(registration: string) {
    return this.vehicleData.lookup(registration);
  }

  scanPlate(file?: Express.Multer.File) {
    return this.anpr.recognise({
      originalName: file?.originalname ?? 'plate.jpg',
      buffer: file?.buffer,
      mimeType: file?.mimetype,
    });
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
