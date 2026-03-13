import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.organizationId) return false;

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        organizationId: user.organizationId,
        status: { in: ['active', 'trialing'] },
      },
    });

    if (!subscription) throw new ForbiddenException('No active subscription');

    // Get current period usage
    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);

    const usage = await this.prisma.usageRecord.findFirst({
      where: {
        organizationId: user.organizationId,
        periodStart: { gte: periodStart },
      },
    });

    const used = usage?.documentsProcessed ?? 0;

    if (
      subscription.documentsPerMonth !== -1 &&
      used >= subscription.documentsPerMonth
    ) {
      throw new ForbiddenException(
        `Monthly limit reached (${subscription.documentsPerMonth} docs). Upgrade your plan.`,
      );
    }

    return true;
  }
}
