import { Controller, Get } from '@nestjs/common';
import { SkipRateLimit } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @SkipRateLimit()
  check() {
    return {
      status: 'ok',
      service: '@server/api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @SkipRateLimit()
  async ready() {
    await this.prisma.client.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'up' };
  }
}
