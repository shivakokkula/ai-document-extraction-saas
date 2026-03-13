import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import Stripe from 'stripe';

export const PLANS = {
  free:       { documentsPerMonth: 10,   apiCallsPerMonth: 100,  maxFileSizeMb: 5   },
  pro:        { documentsPerMonth: 500,  apiCallsPerMonth: 5000, maxFileSizeMb: 50  },
  enterprise: { documentsPerMonth: -1,   apiCallsPerMonth: -1,   maxFileSizeMb: 200 },
};

@Injectable()
export class BillingService {
  private stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService, private config: ConfigService) {
    this.stripe = new Stripe(config.get('stripe.secretKey')!, { apiVersion: '2024-06-20' });
  }

  async getPlans() {
    return {
      free:       { name: 'Free',       price: 0,     currency: 'inr', ...PLANS.free,       features: ['10 documents/month', 'JSON export', 'Email support'] },
      pro:        { name: 'Pro',        price: 1999,  currency: 'inr', ...PLANS.pro,        features: ['500 documents/month', 'CSV + JSON export', 'API access', 'Priority support'] },
      enterprise: { name: 'Enterprise', price: 9999,  currency: 'inr', ...PLANS.enterprise, features: ['Unlimited documents', 'API access', 'SSO', 'Dedicated support', 'SLA'] },
    };
  }

  async createCheckoutSession(organizationId: string, userId: string, plan: 'pro' | 'enterprise') {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: org.name,
        metadata: { organizationId, userId },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const priceId = plan === 'pro'
      ? this.config.get('stripe.proPriceId')
      : this.config.get('stripe.enterprisePriceId');

    const frontendUrl = this.config.get('frontendUrl');
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/dashboard/billing?canceled=true`,
      subscription_data: {
        metadata: { organizationId, plan },
        trial_period_days: 14,
      },
      allow_promotion_codes: true,
    });

    return { url: session.url };
  }

  async createPortalSession(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (!org.stripeCustomerId) throw new BadRequestException('No billing account found');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${this.config.get('frontendUrl')}/dashboard/billing`,
    });

    return { url: session.url };
  }

  async getSubscription(organizationId: string) {
    return this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: ['active', 'trialing'] } },
    });
  }

  async getUsage(organizationId: string) {
    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);

    const [subscription, usage] = await Promise.all([
      this.getSubscription(organizationId),
      this.prisma.usageRecord.findFirst({
        where: { organizationId, periodStart: { gte: periodStart } },
      }),
    ]);

    return {
      documentsUsed: usage?.documentsProcessed ?? 0,
      documentsLimit: subscription?.documentsPerMonth ?? 10,
      pagesProcessed: usage?.pagesProcessed ?? 0,
      periodStart,
      periodEnd: new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0),
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody, signature, this.config.get('stripe.webhookSecret')!,
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Stripe event: ${event.type}`);

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.cancelSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
  }

  private async syncSubscription(sub: Stripe.Subscription) {
    const orgId = sub.metadata.organizationId;
    const plan = (sub.metadata.plan || 'free') as keyof typeof PLANS;
    const planConfig = PLANS[plan];

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.upsert({
        where: { stripeSubscriptionId: sub.id },
        create: {
          organizationId: orgId,
          stripeSubscriptionId: sub.id,
          stripePriceId: sub.items.data[0]?.price.id,
          status: sub.status as any,
          plan: plan as any,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          ...planConfig,
        },
        update: {
          status: sub.status as any,
          plan: plan as any,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          ...planConfig,
        },
      });
      await tx.organization.update({ where: { id: orgId }, data: { plan: plan as any } });
    });
  }

  private async cancelSubscription(sub: Stripe.Subscription) {
    const orgId = sub.metadata.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: 'canceled', canceledAt: new Date() },
      });
      await tx.organization.update({ where: { id: orgId }, data: { plan: 'free' } });
      // Reset to free limits
      await tx.subscription.create({
        data: {
          organizationId: orgId,
          plan: 'free',
          status: 'active',
          ...PLANS.free,
        },
      });
    });
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice) {
    this.logger.warn(`Payment failed for invoice: ${invoice.id}`);
    if (invoice.subscription) {
      await this.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: invoice.subscription as string },
        data: { status: 'past_due' },
      });
    }
  }
}
