import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { type Env, isFakeBillingEnabled } from '../config/env.schema';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BILLING_VERIFIER_LIST, type BillingVerifier } from './billing-verifier';
import { FakeBillingVerifier } from './fake-billing-verifier';
import { PlansService } from './plans.service';
import { AppleBillingVerifier, GoogleBillingVerifier } from './store-verifiers';

@Module({})
export class BillingModule {
  /** Apple and Google verifiers always exist (fail-closed stubs); the fake one only in fake mode. */
  static register(env: Env): DynamicModule {
    const verifierClasses = [
      AppleBillingVerifier,
      GoogleBillingVerifier,
      ...(isFakeBillingEnabled(env) ? [FakeBillingVerifier] : []),
    ];
    const verifierList: Provider = {
      provide: BILLING_VERIFIER_LIST,
      inject: verifierClasses,
      useFactory: (...verifiers: BillingVerifier[]) => verifiers,
    };
    return {
      module: BillingModule,
      imports: [EntitlementsModule],
      controllers: [BillingController],
      providers: [PlansService, BillingService, ...verifierClasses, verifierList],
      exports: [BillingService, PlansService],
    };
  }
}
