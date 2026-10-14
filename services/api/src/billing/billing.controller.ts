import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-docs';
import { type AuthUser, CurrentUser, Public } from '../common/request-context';
import { PlanDto, SubscriptionViewDto, VerifyPurchaseDto } from './billing.dto';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';

@ApiTags('subscriptions')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly plans: PlansService,
  ) {}

  @Get('plans')
  @Public()
  @ApiOperation({
    summary: 'Subscription plans and their store product ids',
    description: 'Prices come from the store SDK, not from this API.',
  })
  @ApiOkResponse({ type: PlanDto, isArray: true })
  listPlans(): Promise<PlanDto[]> {
    return this.plans.list();
  }

  @Get('me/subscription')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Current subscription state; `status: "none"` if never subscribed' })
  @ApiOkResponse({ type: SubscriptionViewDto })
  @ApiErrors('UNAUTHENTICATED', 'ACCOUNT_INACTIVE')
  mySubscription(@CurrentUser() user: AuthUser): Promise<SubscriptionViewDto> {
    return this.billing.getView(user.id);
  }

  @Post('purchases/verify')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Verify a store purchase with the provider and link it to the signed-in user',
  })
  @ApiOkResponse({ type: SubscriptionViewDto })
  @ApiErrors(
    'VALIDATION_FAILED',
    'INVALID_PURCHASE',
    'UNAUTHENTICATED',
    'ACCOUNT_INACTIVE',
    'PURCHASE_BELONGS_TO_OTHER_ACCOUNT',
    'PROVIDER_NOT_CONFIGURED',
  )
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyPurchaseDto): Promise<SubscriptionViewDto> {
    return this.billing.verifyPurchase(user.id, dto);
  }
}
