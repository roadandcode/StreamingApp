import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/api-docs';
import { type AuthUser, CurrentUser } from '../../common/request-context';
import { SubscriptionViewDto } from '../billing.dto';
import { RazorpayCheckoutService } from './razorpay-checkout.service';
import {
  CreateRazorpaySubscriptionDto,
  RazorpayCheckoutSubscriptionDto,
  VerifyRazorpayCheckoutDto,
} from './razorpay.dto';

@ApiTags('web checkout')
@ApiBearerAuth('bearer')
@ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE', 'PROVIDER_NOT_CONFIGURED')
@Controller('checkout/razorpay')
export class RazorpayCheckoutController {
  constructor(private readonly checkout: RazorpayCheckoutService) {}

  @Post('subscriptions')
  @ApiOperation({
    summary: 'Create a Razorpay subscription for a plan (web)',
    description: 'Open Razorpay Checkout with the returned keyId and razorpaySubscriptionId.',
  })
  @ApiCreatedResponse({ type: RazorpayCheckoutSubscriptionDto })
  @ApiErrors('VALIDATION_FAILED', 'NOT_FOUND', 'INVALID_PURCHASE', 'SERVICE_UNAVAILABLE')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRazorpaySubscriptionDto): Promise<RazorpayCheckoutSubscriptionDto> {
    return this.checkout.createSubscription(user.id, dto.planCode);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Apply the result of Razorpay Checkout',
    description:
      'Checks razorpay_signature (HMAC-SHA256 of "payment_id|subscription_id" with the key secret), then ' +
      're-reads the subscription from Razorpay.',
  })
  @ApiOkResponse({ type: SubscriptionViewDto })
  @ApiErrors('VALIDATION_FAILED', 'INVALID_PURCHASE', 'PURCHASE_BELONGS_TO_OTHER_ACCOUNT', 'SERVICE_UNAVAILABLE')
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyRazorpayCheckoutDto): Promise<SubscriptionViewDto> {
    return this.checkout.verify(user.id, dto);
  }
}
