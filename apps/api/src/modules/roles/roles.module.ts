import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators';

@ApiTags('Roles & permissions')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  async roles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
    });
    return roles.map(({ permissions, _count, ...r }) => ({
      ...r, userCount: _count.users, permissions: permissions.map((p) => p.permission.code).sort(),
    }));
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }
}

@Module({ controllers: [RolesController] })
export class RolesModule {}
