import { createDatabase, createPool, redactDatabaseUrl } from './connection';
import { loadEnvFile } from './load-env-file';
import { DEFAULT_DATABASE_URL } from './migrate';
import { seedDatabase } from './seed-data';

async function main(): Promise<void> {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || undefined;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || undefined;
  if (adminPassword && adminPassword.length < 10) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
  }
  if (!adminEmail || !adminPassword) {
    console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: skipping the admin user.');
  }
  const pool = createPool(databaseUrl);
  try {
    const summary = await seedDatabase(createDatabase(pool), {
      adminEmail,
      adminPassword,
      region: process.env.DEFAULT_COUNTRY_CODE?.trim().toUpperCase() || 'IN',
      razorpayPlanIds: {
        monthly: process.env.RAZORPAY_PLAN_ID_MONTHLY?.trim() || undefined,
        yearly: process.env.RAZORPAY_PLAN_ID_YEARLY?.trim() || undefined,
      },
    });
    console.log(
      `Seeded ${redactDatabaseUrl(databaseUrl)}: admin ${summary.admin}, ${summary.plans} plans, ` +
        `${summary.storeProducts} store products, ${summary.content} content items.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
