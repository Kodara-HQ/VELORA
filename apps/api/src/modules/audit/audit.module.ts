import { Controller, Get, Global, Injectable, Logger, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import type { RequestContext } from '../../common/types';

export interface AuditEntry {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  ctx?: RequestContext;
}

const REDACT = /password|token|secret|hash/i;
function redact(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (REDACT.test(k) ? '[REDACTED]' : val)));
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an audit entry. Pass `tx` to write inside the caller's transaction so the
   * audit row commits (or rolls back) together with the change it describes.
   */
  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma) {
    try {
      await tx.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId != null ? String(entry.entityId) : null,
          oldValues: redact(entry.oldValues),
          newValues: redact(entry.newValues),
          ipAddress: entry.ctx?.ip ?? null,
          userAgent: entry.ctx?.userAgent ?? null,
        },
      });
    } catch (e) {
      if (tx !== this.prisma) throw e; // inside a transaction: fail the whole operation
      this.logger.error(`Failed to write audit log for ${entry.action}`, e as Error);
    }
  }
}

class AuditQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() userId?: number;
}

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async list(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      entityType: q.entityType, entityId: q.entityId, userId: q.userId,
      ...(q.action && { action: { startsWith: q.action } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where, skip: q.skip, take: q.pageSize, orderBy: { createdAt: q.order },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
