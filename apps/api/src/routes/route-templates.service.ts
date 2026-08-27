import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ROUTE_TEMPLATE_DEFINITIONS,
  parseRouteWaypoints,
  type GeoPoint,
} from '@vip/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class RouteTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const templates = await this.prisma.routeTemplate.findMany({
      where: {
        active: true,
        OR: [{ organisationId: null }, { organisationId: user.organisationId }],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return templates.map((template) => this.present(template));
  }

  async requireAssignable(user: AuthUser, id: string) {
    const template = await this.prisma.routeTemplate.findFirst({
      where: {
        id,
        active: true,
        OR: [{ organisationId: null }, { organisationId: user.organisationId }],
      },
    });
    if (!template) {
      throw new NotFoundException('Route template not found');
    }
    return template;
  }

  async defaultTemplateId() {
    const template = await this.prisma.routeTemplate.findFirst({
      where: { code: 'UK_BG_GR_CENTRAL', active: true },
      select: { id: true },
    });
    return template?.id ?? null;
  }

  waypointsOf(template: { waypoints: unknown } | null | undefined): GeoPoint[] {
    if (!template) return [];
    return parseRouteWaypoints(template.waypoints);
  }

  present(template: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    waypoints: unknown;
    sortOrder: number;
  }) {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      waypoints: parseRouteWaypoints(template.waypoints),
      sortOrder: template.sortOrder,
    };
  }
}

/** Idempotent seed helper for platform corridors. */
export async function seedPlatformRouteTemplates(prisma: PrismaService) {
  for (const definition of ROUTE_TEMPLATE_DEFINITIONS) {
    await prisma.routeTemplate.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        description: definition.description,
        waypoints: definition.waypoints,
        sortOrder: definition.sortOrder,
        active: true,
        organisationId: null,
      },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        waypoints: definition.waypoints,
        sortOrder: definition.sortOrder,
        active: true,
        organisationId: null,
      },
    });
  }
}
