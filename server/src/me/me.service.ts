import { Injectable } from '@nestjs/common';
import type { MeResponse, ProfileUpdate } from '@repo/core';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Updates name / primaryLocale of the caller only; email, roles and avatar are not editable. */
  async updateProfile(userId: string, patch: ProfileUpdate): Promise<MeResponse> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.primaryLocale !== undefined && { primaryLocale: patch.primaryLocale }),
      },
    });
    return this.auth.getMe(userId);
  }
}
