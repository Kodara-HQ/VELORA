import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import { PERMISSIONS, ROLE_DEFINITIONS, STAFF_ROLES, type AuthUser, type RoleCode } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { TokensService } from '../auth/tokens.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import { GH_PHONE_RULE, PASSWORD_MESSAGE, PASSWORD_RULE } from '../auth/dto/auth.dto';

const ROLE_CODES = Object.keys(ROLE_DEFINITIONS) as RoleCode[];

class UserListQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ROLE_CODES }) @IsOptional() @IsIn(ROLE_CODES) role?: RoleCode;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional({ enum: ['staff', 'customer', 'vendor'] }) @IsOptional() @IsIn(['staff', 'customer', 'vendor'])
  kind?: 'staff' | 'customer' | 'vendor';
}

class CreateStaffDto {
  @ApiProperty() @Transform(({ value }) => String(value).trim().toLowerCase()) @IsEmail() @MaxLength(191) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) lastName: string;
  @ApiPropertyOptional() @IsOptional() @Matches(GH_PHONE_RULE, { message: 'Enter a Ghana mobile number like +233241234567' }) phone?: string;
  @ApiProperty({ description: 'Temporary password; staff should change it after first sign-in' })
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) password: string;
  @ApiProperty({ enum: STAFF_ROLES, isArray: true }) @IsArray() @ArrayUnique() @ArrayMaxSize(5) @IsIn(STAFF_ROLES, { each: true })
  roles: RoleCode[];
}

class UpdateStatusDto {
  @ApiProperty({ enum: UserStatus }) @IsEnum(UserStatus) status: UserStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class SetRolesDto {
  @ApiProperty({ enum: ROLE_CODES, isArray: true }) @IsArray() @ArrayUnique() @ArrayMaxSize(6) @IsIn(ROLE_CODES, { each: true })
  roles: RoleCode[];
}

const userSelect = {
  id: true, email: true, phone: true, firstName: true, lastName: true, status: true, avatarUrl: true,
  lastLoginAt: true, createdAt: true, emailVerifiedAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;
const present = (u: UserRow) => ({ ...u, roles: u.roles.map((r) => r.role) });

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokensService,
  ) {}

  async list(q: UserListQuery) {
    const roleFilter: Prisma.UserWhereInput =
      q.role ? { roles: { some: { role: { code: q.role } } } }
      : q.kind === 'staff' ? { roles: { some: { role: { code: { in: STAFF_ROLES } } } } }
      : q.kind ? { roles: { some: { role: { code: q.kind } } } }
      : {};
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: q.status,
      ...roleFilter,
      ...(q.q && { OR: [
        { email: { contains: q.q } }, { firstName: { contains: q.q } }, { lastName: { contains: q.q } }, { phone: { contains: q.q } },
      ] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: userSelect, skip: q.skip, take: q.pageSize, orderBy: { createdAt: q.order } }),
      this.prisma.user.count({ where }),
    ]);
    return new Paginated(rows.map(present), total, q);
  }

  async get(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...userSelect,
        customer: true,
        loyaltyAccount: { select: { pointsBalance: true, lifetimePoints: true, tier: true } },
        ownedVendors: { select: { id: true, businessName: true, status: true } },
        loginActivities: { take: 10, orderBy: { createdAt: 'desc' }, select: { success: true, reason: true, ipAddress: true, createdAt: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return { ...user, roles: user.roles.map((r) => r.role) };
  }

  async createStaff(actor: AuthUser, dto: CreateStaffDto, ctx: ReturnType<typeof requestContext>) {
    this.assertCanGrant(actor, dto.roles);
    const roles = await this.prisma.role.findMany({ where: { code: { in: dto.roles } } });
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email, phone: dto.phone, firstName: dto.firstName, lastName: dto.lastName, passwordHash,
          roles: { create: roles.map((r) => ({ roleId: r.id, assignedBy: actor.id })) },
        },
        select: userSelect,
      });
      await this.audit.log({ userId: actor.id, action: 'users.staff_created', entityType: 'user', entityId: user.id,
        newValues: { email: dto.email, roles: dto.roles }, ctx }, tx);
      return present(user);
    });
  }

  async setStatus(actor: AuthUser, id: number, dto: UpdateStatusDto, ctx: ReturnType<typeof requestContext>) {
    if (actor.id === id) throw new BadRequestException('You cannot change the status of your own account');
    const target = await this.get(id);
    this.assertCanTouch(actor, target.roles.map((r) => r.code as RoleCode));
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: dto.status } });
      if (dto.status !== UserStatus.ACTIVE) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log({ userId: actor.id, action: 'users.status_changed', entityType: 'user', entityId: id,
        oldValues: { status: target.status }, newValues: { status: dto.status, reason: dto.reason }, ctx }, tx);
    });
    return this.get(id);
  }

  async setRoles(actor: AuthUser, id: number, dto: SetRolesDto, ctx: ReturnType<typeof requestContext>) {
    const target = await this.get(id);
    const before = target.roles.map((r) => r.code as RoleCode);
    this.assertCanTouch(actor, before);
    this.assertCanGrant(actor, dto.roles);
    if (actor.id === id && before.includes('super_admin') && !dto.roles.includes('super_admin')) {
      throw new BadRequestException('You cannot remove your own Super Administrator role');
    }
    if (before.includes('super_admin') && !dto.roles.includes('super_admin')) {
      const remaining = await this.prisma.userRole.count({
        where: { role: { code: 'super_admin' }, userId: { not: id }, user: { status: UserStatus.ACTIVE, deletedAt: null } },
      });
      if (!remaining) throw new BadRequestException('At least one active Super Administrator must remain');
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: dto.roles } } });
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id, assignedBy: actor.id })) });
      await this.audit.log({ userId: actor.id, action: 'users.roles_changed', entityType: 'user', entityId: id,
        oldValues: { roles: before }, newValues: { roles: dto.roles }, ctx }, tx);
    });
    return this.get(id);
  }

  /** Only a Super Administrator may grant or modify Super Administrator accounts. */
  private assertCanGrant(actor: AuthUser, roles: RoleCode[]) {
    if (roles.includes('super_admin') && !actor.roles.includes('super_admin')) {
      throw new ForbiddenException('Only a Super Administrator can grant that role');
    }
  }

  private assertCanTouch(actor: AuthUser, targetRoles: RoleCode[]) {
    if (targetRoles.includes('super_admin') && !actor.roles.includes('super_admin')) {
      throw new ForbiddenException('Only a Super Administrator can modify this account');
    }
  }
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  list(@Query() q: UserListQuery) {
    return this.users.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  get(@Param('id', ParseIntPipe) id: number) {
    return this.users.get(id);
  }

  @Post('staff')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE, PERMISSIONS.ROLES_VIEW)
  createStaff(@CurrentUser() actor: AuthUser, @Body() dto: CreateStaffDto, @Req() req: Request) {
    return this.users.createStaff(actor, dto, requestContext(req));
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  setStatus(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStatusDto, @Req() req: Request) {
    return this.users.setStatus(actor, id, dto, requestContext(req));
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  setRoles(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetRolesDto, @Req() req: Request) {
    return this.users.setRoles(actor, id, dto, requestContext(req));
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
