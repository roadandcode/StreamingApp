import { eq, sql } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import type { Database } from './database.types';
import {
  type AccessTier,
  type BillingPeriod,
  type BillingProvider,
  content,
  contentRegions,
  plans,
  storeProducts,
  subtitles,
  users,
  videoAssets,
} from './schema';

/** Fixed ids so the seed is idempotent and docs/tests can refer to the sample content. */
export const SEED_IDS = {
  freeCourse: '5eed0000-0000-4000-8000-000000000001',
  freeLesson1: '5eed0000-0000-4000-8000-000000000002',
  freeLesson2: '5eed0000-0000-4000-8000-000000000003',
  premiumCourse: '5eed0000-0000-4000-8000-000000000011',
  premiumLesson1: '5eed0000-0000-4000-8000-000000000012',
  premiumLesson2: '5eed0000-0000-4000-8000-000000000013',
} as const;

export const SEED_PLANS: ReadonlyArray<{
  code: string;
  name: string;
  billingPeriod: BillingPeriod;
  accessTier: AccessTier;
  products: ReadonlyArray<{ provider: BillingProvider; productId: string }>;
}> = [
  {
    code: 'premium_monthly',
    name: 'Premium (monthly)',
    billingPeriod: 'P1M',
    accessTier: 'premium',
    products: [
      { provider: 'apple', productId: 'com.roadandcode.streamingapp.premium.monthly' },
      { provider: 'google', productId: 'premium_monthly' },
      { provider: 'fake', productId: 'fake_premium_monthly' },
    ],
  },
  {
    code: 'premium_yearly',
    name: 'Premium (yearly)',
    billingPeriod: 'P1Y',
    accessTier: 'premium',
    products: [
      { provider: 'apple', productId: 'com.roadandcode.streamingapp.premium.yearly' },
      { provider: 'google', productId: 'premium_yearly' },
      { provider: 'fake', productId: 'fake_premium_yearly' },
    ],
  },
];

interface SeedContent {
  id: string;
  kind: 'course' | 'lesson';
  parentId: string | null;
  position: number;
  title: string;
  description: string;
  accessTier: AccessTier;
  defaultLanguage: string;
  ageRating: string | null;
  durationSeconds: number | null;
}

const SEED_CONTENT: SeedContent[] = [
  {
    id: SEED_IDS.freeCourse,
    kind: 'course',
    parentId: null,
    position: 0,
    title: 'Getting Started',
    description: 'A free introductory course. Anyone with an account can watch it.',
    accessTier: 'free',
    defaultLanguage: 'en',
    ageRating: 'U',
    durationSeconds: null,
  },
  {
    id: SEED_IDS.freeLesson1,
    kind: 'lesson',
    parentId: SEED_IDS.freeCourse,
    position: 1,
    title: 'Welcome',
    description: 'What this course covers.',
    accessTier: 'free',
    defaultLanguage: 'en',
    ageRating: 'U',
    durationSeconds: 596,
  },
  {
    id: SEED_IDS.freeLesson2,
    kind: 'lesson',
    parentId: SEED_IDS.freeCourse,
    position: 2,
    title: 'Finding your way around',
    description: 'How courses, lessons and downloads work.',
    accessTier: 'free',
    defaultLanguage: 'en',
    ageRating: 'U',
    durationSeconds: 596,
  },
  {
    id: SEED_IDS.premiumCourse,
    kind: 'course',
    parentId: null,
    position: 1,
    title: 'Premium Masterclass',
    description: 'The full masterclass, available to subscribers.',
    accessTier: 'premium',
    defaultLanguage: 'hi',
    ageRating: 'UA 13+',
    durationSeconds: null,
  },
  {
    id: SEED_IDS.premiumLesson1,
    kind: 'lesson',
    parentId: SEED_IDS.premiumCourse,
    position: 1,
    title: 'Masterclass, part 1',
    description: 'Foundations.',
    accessTier: 'premium',
    defaultLanguage: 'hi',
    ageRating: 'UA 13+',
    durationSeconds: 596,
  },
  {
    id: SEED_IDS.premiumLesson2,
    kind: 'lesson',
    parentId: SEED_IDS.premiumCourse,
    position: 2,
    title: 'Masterclass, part 2',
    description: 'Putting it together.',
    accessTier: 'premium',
    defaultLanguage: 'hi',
    ageRating: 'UA 13+',
    durationSeconds: 596,
  },
];

export interface SeedOptions {
  adminEmail?: string;
  adminPassword?: string;
  /** Country the sample content is published in. */
  region?: string;
}

export interface SeedSummary {
  admin: 'created' | 'updated' | 'skipped';
  plans: number;
  storeProducts: number;
  content: number;
}

/** Idempotent development seed: admin user, plans and store products, sample free and premium courses. */
export async function seedDatabase(db: Database, options: SeedOptions = {}): Promise<SeedSummary> {
  const region = options.region ?? 'IN';
  let admin: SeedSummary['admin'] = 'skipped';
  if (options.adminEmail && options.adminPassword) {
    const email = options.adminEmail.trim().toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      // Never overwrite an existing password; just make sure the account is an active admin.
      await db.update(users).set({ role: 'admin', accountStatus: 'active', deletedAt: null }).where(eq(users.id, existing.id));
      admin = 'updated';
    } else {
      await db.insert(users).values({
        email,
        passwordHash: await hashPassword(options.adminPassword),
        displayName: 'Admin',
        role: 'admin',
        accountStatus: 'active',
        emailVerifiedAt: new Date(),
      });
      admin = 'created';
    }
  }

  let productCount = 0;
  await db.transaction(async (tx) => {
    for (const plan of SEED_PLANS) {
      const [row] = await tx
        .insert(plans)
        .values({ code: plan.code, name: plan.name, billingPeriod: plan.billingPeriod, accessTier: plan.accessTier })
        .onConflictDoUpdate({
          target: plans.code,
          set: { name: plan.name, billingPeriod: plan.billingPeriod, accessTier: plan.accessTier },
        })
        .returning({ id: plans.id });
      if (!row) throw new Error(`Could not upsert plan ${plan.code}`);
      for (const product of plan.products) {
        await tx
          .insert(storeProducts)
          .values({ provider: product.provider, productId: product.productId, storefront: 'default', planId: row.id })
          .onConflictDoUpdate({
            target: [storeProducts.provider, storeProducts.productId, storeProducts.storefront],
            set: { planId: row.id },
          });
        productCount += 1;
      }
    }

    for (const item of SEED_CONTENT) {
      await tx
        .insert(content)
        .values({ ...item, publicationStatus: 'published' })
        .onConflictDoNothing({ target: content.id });
      await tx
        .insert(contentRegions)
        .values({ contentId: item.id, countryCode: region })
        .onConflictDoNothing({ target: [contentRegions.contentId, contentRegions.countryCode] });
      if (item.kind === 'lesson') {
        await tx
          .insert(videoAssets)
          .values({
            contentId: item.id,
            provider: 'fake',
            providerAssetId: `fake_seed_${item.id}`,
            processingStatus: 'ready',
            publishedAt: sql`now()`,
          })
          .onConflictDoNothing({ target: videoAssets.providerAssetId });
      }
    }

    await tx
      .insert(subtitles)
      .values({ contentId: SEED_IDS.freeLesson1, language: 'en', label: 'English' })
      .onConflictDoNothing({ target: [subtitles.contentId, subtitles.language] });
  });

  return { admin, plans: SEED_PLANS.length, storeProducts: productCount, content: SEED_CONTENT.length };
}
