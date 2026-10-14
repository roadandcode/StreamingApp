import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const RAZORPAY_ID = /^[A-Za-z0-9_]{1,100}$/;

export class CreateRazorpaySubscriptionDto {
  @ApiProperty({ example: 'premium_monthly', description: 'Plan code from GET /v1/plans' })
  @Matches(/^[a-z0-9_]{1,50}$/, { message: 'planCode must be a plan code such as premium_monthly' })
  planCode: string;
}

export class RazorpayCheckoutSubscriptionDto {
  @ApiProperty({ example: 'sub_00000000000001', description: 'Pass to Razorpay Checkout as subscription_id' })
  razorpaySubscriptionId: string;

  @ApiProperty({ description: 'Razorpay key id for Checkout (public)' })
  keyId: string;

  @ApiProperty({ example: 'premium_monthly' })
  planCode: string;
}

export class VerifyRazorpayCheckoutDto {
  @ApiProperty({ description: 'razorpay_subscription_id returned by Checkout' })
  @Matches(RAZORPAY_ID, { message: 'razorpaySubscriptionId is not a Razorpay id' })
  razorpaySubscriptionId: string;

  @ApiProperty({ description: 'razorpay_payment_id returned by Checkout' })
  @Matches(RAZORPAY_ID, { message: 'razorpayPaymentId is not a Razorpay id' })
  razorpayPaymentId: string;

  @ApiProperty({ description: 'razorpay_signature returned by Checkout' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  razorpaySignature: string;
}
