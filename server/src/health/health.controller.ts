import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { PrismaService } from '../prisma/prisma.service';
import { HealthReadyResponseDto, HealthResponseDto } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Liveness probe' })
  @ZodResponse({ status: 200, description: 'Service is up', type: HealthResponseDto })
  @Get()
  check() {
    return {
      status: 'ok' as const,
      service: '@server/api',
      timestamp: new Date().toISOString(),
    };
  }

  @ApiOperation({ summary: 'Readiness probe (checks the database)' })
  @ZodResponse({ status: 200, description: 'Database reachable', type: HealthReadyResponseDto })
  @Get('ready')
  async ready() {
    await this.prisma.client.$queryRaw`SELECT 1`;
    return { status: 'ok' as const, db: 'up' as const };
  }
}
