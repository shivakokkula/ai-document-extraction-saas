import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        subscriptions: { where: { status: { in: ['active', 'trialing'] } }, take: 1 },
        _count: { select: { users: true, documents: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, data: { name?: string; billingEmail?: string }) {
    return this.prisma.organization.update({ where: { id }, data });
  }

  async listMembers(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, email: true, fullName: true, role: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeMember(organizationId: string, userId: string, requesterId: string) {
    if (userId === requesterId) throw new ForbiddenException('Cannot remove yourself');
    const member = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner') throw new ForbiddenException('Cannot remove the owner');
    return this.prisma.user.update({ where: { id: userId }, data: { organizationId: null } });
  }
}
