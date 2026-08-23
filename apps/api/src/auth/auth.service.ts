import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { organisation: true },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user);
  }

  toAuthUser(user: {
    id: string;
    organisationId: string;
    organisation: { name: string };
    email: string;
    name: string;
    role: AuthUser['role'];
    customerId: string | null;
  }): AuthUser {
    return {
      id: user.id,
      organisationId: user.organisationId,
      organisationName: user.organisation.name,
      email: user.email,
      name: user.name,
      role: user.role,
      customerId: user.customerId,
    };
  }

  private async issueSession(user: Parameters<AuthService['toAuthUser']>[0] & { id: string }) {
    const authUser = this.toAuthUser(user);
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, user: authUser };
  }
}
