import { Injectable } from '@nestjs/common';
import { UserStatus, VendorStatus } from '@prisma/client';
import type { AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Builds the authenticated principal (roles, effective permissions, vendor scope).
 * Called on every authenticated request. Phase 6 adds a short Redis cache invalidated on role changes.
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: number): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE, deletedAt: null },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        ownedVendors: { where: { status: VendorStatus.ACTIVE, deletedAt: null }, select: { id: true }, take: 1 },
      },
    });
    if (!user) return null;

    const roles = user.roles.map((ur) => ur.role.code);
    const permissions = [...new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))];
    // A vendor-role user whose shop is not ACTIVE (pending, suspended) gets no vendor-portal access.
    const vendorId = roles.includes('vendor') ? (user.ownedVendors[0]?.id ?? null) : null;
    const effective = vendorId ? permissions : permissions.filter((p) => !p.startsWith('vendor_portal.'));

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      roles,
      permissions: effective.sort(),
      vendorId,
    };
  }
}
