import {
  Controller, Post, Req, Headers, RawBodyRequest, BadRequestException, Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BillingService } from './billing.service';

@ApiTags('Webhooks')
@Controller('billing/webhook')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private billingService: BillingService) {}

  // No JWT guard — Stripe must be able to call this
  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new BadRequestException('Missing stripe-signature header');
    const rawBody = req.rawBody;
    if (!rawBody) throw new BadRequestException('Missing raw body');

    await this.billingService.handleWebhook(rawBody, signature);
    return { received: true };
  }
}
