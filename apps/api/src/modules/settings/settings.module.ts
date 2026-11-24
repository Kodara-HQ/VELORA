import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators';

@ApiTags('Platform')
@Controller()
export class PlatformController {
  constructor(private readonly prisma: PrismaService) {}

  /** Storefront-safe configuration (store name, currency, loyalty rates…), grouped. */
  @Public()
  @Get('settings/public')
  async publicSettings() {
    const rows = await this.prisma.systemSetting.findMany({ where: { isPublic: true }, select: { group: true, key: true, value: true } });
    const out: Record<string, Record<string, unknown>> = {};
    for (const r of rows) (out[r.group] ??= {})[r.key] = r.value;
    return out;
  }

  @Public()
  @SkipThrottle()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', database: 'up', time: new Date().toISOString() };
  }
}

@Module({ controllers: [PlatformController] })
export class PlatformModule {}
