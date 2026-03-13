import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { organization: true },
      omit: { passwordHash: true, resetToken: true, emailVerifyToken: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(id: string, data: { fullName?: string; avatarUrl?: string }) {
    return this.prisma.user.update({
      where: { id },
      data,
      omit: { passwordHash: true, resetToken: true, emailVerifyToken: true },
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
