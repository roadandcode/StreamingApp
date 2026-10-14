import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { type Env, isFakeBillingEnabled, isRazorpayConfigured } from '../config/env.schema';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BILLING_VERIFIER_LIST, type BillingVerifier } from './billing-verifier';
import { FakeBillingVerifier } from './fake-billing-verifier';
import { PlansService } from './plans.service';
import { RazorpayBillingVerifier } from './razorpay/razorpay-billing-verifier';
import { RazorpayCheckoutController } from './razorpay/razorpay-checkout.controller';
import { RazorpayCheckoutService } from './razorpay/razorpay-checkout.service';
import { HttpRazorpayClient, RAZORPAY_CLIENT, UnconfiguredRazorpayClient } from './razorpay/razorpay-client';
import { AppleBillingVerifier, GoogleBillingVerifier } from './store-verifiers';

@Module({})
export class BillingModule {
  /**
   * Apple, Google and Razorpay verifiers always exist (each fails closed until configured); the fake
   * one only in fake mode.
   */
  static register(env: Env): DynamicModule {
    const verifierClasses = [
      AppleBillingVerifier,
      GoogleBillingVerifier,
      RazorpayBillingVerifier,
      ...(isFakeBillingEnabled(env) ? [FakeBillingVerifier] : []),
    ];
    const verifierList: Provider = {
      provide: BILLING_VERIFIER_LIST,
      inject: verifierClasses,
      useFactory: (...verifiers: BillingVerifier[]) => verifiers,
    };
    const razorpayClient: Provider = {
      provide: RAZORPAY_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const keyId = config.get('RAZORPAY_KEY_ID');
        const keySecret = config.get('RAZORPAY_KEY_SECRET');
        const configured = isRazorpayConfigured({
          RAZORPAY_KEY_ID: keyId,
          RAZORPAY_KEY_SECRET: keySecret,
          RAZORPAY_WEBHOOK_SECRET: config.get('RAZORPAY_WEBHOOK_SECRET'),
        });
        return configured && keyId && keySecret
          ? new HttpRazorpayClient(keyId, keySecret)
          : new UnconfiguredRazorpayClient();
      },
    };
    return {
      module: BillingModule,
      imports: [EntitlementsModule],
      controllers: [BillingController, RazorpayCheckoutController],
      providers: [
        PlansService,
        BillingService,
        RazorpayCheckoutService,
        razorpayClient,
        ...verifierClasses,
        verifierList,
      ],
      exports: [BillingService, PlansService],
    };
  }
}
