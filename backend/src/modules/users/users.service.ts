import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const USER_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  fullName: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  organizationId: true,
  stripeCustomerId: true,
  createdAt: true,
  updatedAt: true,
  organization: true,
  // Intentionally excluded: passwordHash, resetToken, emailVerifyToken
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(id: string, data: { fullName?: string; avatarUrl?: string }) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  }

  async softDelete(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Account deleted' };
  }
}
