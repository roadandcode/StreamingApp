import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ACCESS_TIERS, BILLING_PERIODS, BILLING_PROVIDERS, SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '../common/enums';
import type { AccessTier, BillingPeriod, BillingProvider } from '../database/schema';

export class StoreProductDto {
  @ApiProperty({ enum: BILLING_PROVIDERS, enumName: 'BillingProvider' })
  provider: BillingProvider;

  @ApiProperty({ example: 'com.roadandcode.streamingapp.premium.monthly' })
  productId: string;
}

export class PlanDto {
  @ApiProperty({ example: 'premium_monthly' })
  code: string;

  @ApiProperty({ example: 'Premium (monthly)' })
  name: string;

  @ApiProperty({ enum: BILLING_PERIODS, enumName: 'BillingPeriod', description: 'ISO-8601 duration' })
  billingPeriod: BillingPeriod;

  @ApiProperty({ enum: ACCESS_TIERS, enumName: 'AccessTier' })
  accessTier: AccessTier;

  @ApiProperty({ type: StoreProductDto, isArray: true })
  storeProducts: StoreProductDto[];
}

export class SubscriptionViewDto {
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES, enumName: 'SubscriptionStatus' })
  status: SubscriptionStatus;

  @ApiProperty({ description: 'The only field clients may use to show "premium unlocked" UI.' })
  hasAccess: boolean;

  @ApiProperty({ enum: ACCESS_TIERS, enumName: 'AccessTier', nullable: true })
  accessTier: AccessTier | null;

  @ApiProperty({ type: String, nullable: true, example: 'premium_monthly' })
  planCode: string | null;

  @ApiProperty({ enum: BILLING_PROVIDERS, enumName: 'BillingProvider', nullable: true })
  provider: BillingProvider | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  accessUntil: string | null;

  @ApiProperty()
  autoRenewEnabled: boolean;
}

export class VerifyPurchaseDto {
  @ApiProperty({ enum: BILLING_PROVIDERS, enumName: 'BillingProvider' })
  @IsIn(BILLING_PROVIDERS)
  provider: BillingProvider;

  @ApiProperty({ example: 'fake_premium_monthly' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  productId: string;

  @ApiProperty({
    description:
      'Google Play purchaseToken, Apple signedTransactionInfo JWS, or for provider "fake" the original transaction id.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20_000)
  receipt: string;
}
