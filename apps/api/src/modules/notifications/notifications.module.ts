import { BadRequestException, Body, Controller, Get, Global, HttpCode, Injectable, Logger, Module, NotFoundException, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { LoyaltyTier, NotificationChannel, OutboxStatus, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { requestContext } from '../../common/utils/request';
import { AuditService } from '../audit/audit.module';
import { MessagingService, readPrefs } from './messaging.service';
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

class ChannelPrefs {
  @ApiProperty() @IsBoolean() orders: boolean;
  @ApiProperty() @IsBoolean() marketing: boolean;
}
class PrefsDto {
  @ApiProperty({ type: ChannelPrefs }) @ValidateNested() @Type(() => ChannelPrefs) email: ChannelPrefs;
  @ApiProperty({ type: ChannelPrefs }) @ValidateNested() @Type(() => ChannelPrefs) sms: ChannelPrefs;
}

class OutboxQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: OutboxStatus }) @IsOptional() @IsEnum(OutboxStatus) status?: OutboxStatus;
  @ApiPropertyOptional({ enum: ['EMAIL', 'SMS'] }) @IsOptional() @IsIn(['EMAIL', 'SMS']) channel?: 'EMAIL' | 'SMS';
}

class BroadcastDto {
  @ApiProperty({ enum: ['EMAIL', 'SMS'] }) @IsIn(['EMAIL', 'SMS']) channel: 'EMAIL' | 'SMS';
  @ApiProperty({ description: 'Everyone opted in to marketing, or one loyalty tier' }) @IsIn(['all', ...Object.values(LoyaltyTier)]) audience: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) subject?: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(10) @MaxLength(1000) body: string;
  @ApiPropertyOptional({ description: 'Count recipients without sending' }) @IsOptional() @IsBoolean() dryRun?: boolean;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller()
export class MessagingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
  ) {}

  @Get('me/notification-preferences')
  async prefs(@CurrentUser() u: AuthUser) {
    const c = await this.prisma.customer.findUnique({ where: { userId: u.id } });
    return readPrefs(c?.notificationPrefs, c?.marketingOptIn);
  }

  @Put('me/notification-preferences')
  async setPrefs(@CurrentUser() u: AuthUser, @Body() dto: PrefsDto) {
    const prefs = { email: { orders: dto.email.orders, marketing: dto.email.marketing }, sms: { orders: dto.sms.orders, marketing: dto.sms.marketing } };
    await this.prisma.customer.upsert({
      where: { userId: u.id },
      create: { userId: u.id, notificationPrefs: prefs, marketingOptIn: prefs.email.marketing || prefs.sms.marketing },
      update: { notificationPrefs: prefs, marketingOptIn: prefs.email.marketing || prefs.sms.marketing },
    });
    return prefs;
  }

  @Get('admin/messages') @RequirePermissions(PERMISSIONS.NOTIFICATIONS_SEND)
  async outbox(@Query() q: OutboxQuery) {
    const where: Prisma.MessageOutboxWhereInput = { status: q.status, channel: q.channel, ...(q.q?.trim() && { recipient: { contains: q.q.trim() } }) };
    const [rows, total, counts] = await Promise.all([
      this.prisma.messageOutbox.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.pageSize,
        select: { id: true, channel: true, recipient: true, template: true, subject: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true, nextAttemptAt: true } }),
      this.prisma.messageOutbox.count({ where }),
      this.prisma.messageOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const page = new Paginated(rows, total, q);
    return { items: page.items, meta: page.meta, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  }

  @Get('admin/messages/:id') @RequirePermissions(PERMISSIONS.NOTIFICATIONS_SEND)
  async message(@Param('id', ParseIntPipe) id: number) {
    const m = await this.prisma.messageOutbox.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Message not found');
    return m;
  }

  @Post('admin/messages/:id/retry') @HttpCode(200) @RequirePermissions(PERMISSIONS.NOTIFICATIONS_SEND)
  async retry(@Param('id', ParseIntPipe) id: number) {
    const r = await this.prisma.messageOutbox.updateMany({ where: { id, status: OutboxStatus.FAILED }, data: { status: OutboxStatus.PENDING, attempts: 0, nextAttemptAt: new Date() } });
    if (r.count !== 1) throw new NotFoundException('Only failed messages can be retried');
    return this.messaging.flush();
  }

  @Post('admin/messages/flush') @HttpCode(200) @RequirePermissions(PERMISSIONS.NOTIFICATIONS_SEND)
  flush() { return this.messaging.flush(100); }

  /** Marketing message to customers who opted in on that channel. Queued; the worker sends it in batches. */
  @Post('admin/messages/broadcast') @HttpCode(200) @RequirePermissions(PERMISSIONS.NOTIFICATIONS_SEND)
  async broadcast(@Body() dto: BroadcastDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    if (dto.channel === 'EMAIL' && !dto.subject?.trim()) {
      throw new BadRequestException({ message: 'Add a subject for email campaigns', code: 'VALIDATION_FAILED', details: [{ field: 'subject', messages: ['Add a subject'] }] });
    }
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE', deletedAt: null, customer: { marketingOptIn: true },
        ...(dto.audience !== 'all' && { loyaltyAccount: { tier: dto.audience as LoyaltyTier } }),
        ...(dto.channel === 'SMS' && { phone: { not: null } }),
      },
      select: { id: true, email: true, phone: true, firstName: true, customer: { select: { notificationPrefs: true, marketingOptIn: true } } },
    });
    const recipients = users.filter((x) => {
      const p = readPrefs(x.customer?.notificationPrefs, x.customer?.marketingOptIn);
      return dto.channel === 'EMAIL' ? p.email.marketing : p.sms.marketing;
    });
    if (dto.dryRun) return { recipients: recipients.length, queued: 0 };
    const web = process.env.WEB_APP_URL ?? 'http://localhost:3000';
    await this.prisma.$transaction(async (tx) => {
      for (const r of recipients) {
        await this.messaging.queue(tx, dto.channel === 'EMAIL'
          ? { channel: 'EMAIL', recipient: r.email, userId: r.id, template: 'marketing.broadcast', subject: dto.subject, body: this.messaging.html('Hi ' + r.firstName + ',', dto.body, 'Shop now', web) }
          : { channel: 'SMS', recipient: r.phone!, userId: r.id, template: 'marketing.broadcast', body: 'VELORA: ' + dto.body + ' Reply STOP to opt out.' });
      }
      await this.audit.log({ userId: u.id, action: 'messages.broadcast', entityType: 'message_outbox', newValues: { channel: dto.channel, audience: dto.audience, recipients: recipients.length, subject: dto.subject }, ctx: requestContext(req) }, tx);
    }, { timeout: 60_000 });
    return { recipients: recipients.length, queued: recipients.length };
  }
}

@Global()
@Module({ controllers: [NotificationsController, MessagingController], providers: [NotificationsService, MessagingService], exports: [NotificationsService, MessagingService] })
export class NotificationsModule {}
