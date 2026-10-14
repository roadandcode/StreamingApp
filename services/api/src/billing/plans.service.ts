import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { AppConfig } from '../config/app-config';
import { isFakeBillingEnabled } from '../config/env.schema';
import { type Database, DRIZZLE, type Executor } from '../database/database.types';
import { type BillingProvider, type PlanRow, plans, storeProducts } from '../database/schema';
import type { PlanDto } from './billing.dto';

export const DEFAULT_STOREFRONT = 'default';

@Injectable()
export class PlansService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  private get fakeBillingEnabled(): boolean {
    return isFakeBillingEnabled({ BILLING_MODE: this.config.get('BILLING_MODE'), APP_ENV: this.config.get('APP_ENV') });
  }

  /** Plans with their store product ids. Fake products are listed only in fake billing mode. */
  async list(): Promise<PlanDto[]> {
    const rows = await this.db
      .select({ plan: plans, provider: storeProducts.provider, productId: storeProducts.productId })
      .from(plans)
      .leftJoin(
        storeProducts,
        and(
          eq(storeProducts.planId, plans.id),
          this.fakeBillingEnabled ? undefined : ne(storeProducts.provider, 'fake'),
        ),
      )
      .orderBy(asc(plans.code), asc(storeProducts.provider), asc(storeProducts.productId));
    const byCode = new Map<string, PlanDto>();
    for (const row of rows) {
      let plan = byCode.get(row.plan.code);
      if (!plan) {
        plan = {
          code: row.plan.code,
          name: row.plan.name,
          billingPeriod: row.plan.billingPeriod,
          accessTier: row.plan.accessTier,
          storeProducts: [],
        };
        byCode.set(plan.code, plan);
      }
      if (row.provider && row.productId) {
        plan.storeProducts.push({ provider: row.provider, productId: row.productId });
      }
    }
    return [...byCode.values()];
  }

  async findPlanForProduct(
    provider: BillingProvider,
    productId: string,
    executor: Executor = this.db,
    storefront: string = DEFAULT_STOREFRONT,
  ): Promise<PlanRow | null> {
    const [row] = await executor
      .select({ plan: plans })
      .from(storeProducts)
      .innerJoin(plans, eq(plans.id, storeProducts.planId))
      .where(
        and(
          eq(storeProducts.provider, provider),
          eq(storeProducts.productId, productId),
          eq(storeProducts.storefront, storefront),
        ),
      )
      .limit(1);
    return row?.plan ?? null;
  }
}
