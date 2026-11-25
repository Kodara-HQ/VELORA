import { Controller, Get, Global, HttpCode, Injectable, Logger, Module, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { NotificationChannel, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  /** e.g. { href: '/vendor/products/12' } so the UI can link to the subject */
  data?: Prisma.InputJsonValue;
}

/**
 * In-app notifications (the bell). Email, SMS and push delivery hook in here in Phase 6;
 * callers already describe every event, so adding channels won't change them.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async notify(userIds: number | number[], n: NotifyInput, tx: Prisma.TransactionClient = this.prisma) {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (!ids.length) return;
    try {
      await tx.notification.createMany({
        data: ids.map((userId) => ({ userId, channel: NotificationChannel.IN_APP, type: n.type, title: n.title.slice(0, 200), body: n.body, data: n.data, sentAt: new Date() })),
      });
    } catch (e) {
      if (tx !== this.prisma) throw e;
      this.logger.error(`Failed to store notification ${n.type}`, e as Error); // never break the business action
    }
  }

  /** Everyone holding a permission (e.g. all staff who can approve vendors). */
  async staffWith(permission: string) {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { permissions: { some: { permission: { code: permission } } } } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}

class NotificationQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unread?: boolean;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query() q: NotificationQuery) {
    const where: Prisma.NotificationWhereInput = { userId: u.id, channel: NotificationChannel.IN_APP, ...(q.unread && { readAt: null }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize,
        select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true } }),
      this.prisma.notification.count({ where }),
    ]);
    return new Paginated(rows, total, q);
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { count: await this.prisma.notification.count({ where: { userId: u.id, channel: NotificationChannel.IN_APP, readAt: null } }) };
  }

  @Post(':id/read') @HttpCode(200)
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.prisma.notification.updateMany({ where: { id, userId: u.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('read-all') @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
