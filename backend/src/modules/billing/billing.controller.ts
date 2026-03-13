import {
  Controller, Get, Post, Body, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/index';
import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class CreateCheckoutDto {
  @ApiProperty({ enum: ['pro', 'enterprise'] })
  @IsIn(['pro', 'enterprise'])
  plan: 'pro' | 'enterprise';
}

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Get available plans' })
  getPlans() {
    return this.billingService.getPlans();
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  createCheckout(@Body() dto: CreateCheckoutDto, @CurrentUser() user: any) {
    return this.billingService.createCheckoutSession(user.organizationId, user.id, dto.plan);
  }

  @Post('portal')
  @ApiOperation({ summary: 'Create Stripe billing portal session' })
  createPortal(@CurrentUser() user: any) {
    return this.billingService.createPortalSession(user.organizationId);
  }

  @Get('subscription')
  @ApiOperation({ summary: 'Get current subscription' })
  getSubscription(@CurrentUser() user: any) {
    return this.billingService.getSubscription(user.organizationId);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get current period usage' })
  getUsage(@CurrentUser() user: any) {
    return this.billingService.getUsage(user.organizationId);
  }
}
