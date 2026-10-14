import type { IncomingHttpHeaders } from 'node:http';
import type { BillingProvider, StoredSubscriptionStatus } from '../database/schema';

/**
 * Seam between the backend and the stores. Each provider verifies purchase proofs and server
 * notifications with the store and returns normalized state; the client never asserts status.
 */
export interface VerifiedSubscriptionState {
  provider: BillingProvider;
  /** Store product id as reported by the provider. */
  productId: string;
  /** Apple original transaction id / Google purchase token; stored as provider_subscription_id. */
  originalTransactionId: string;
  latestTransactionId: string | null;
  status: StoredSubscriptionStatus;
  currentPeriodEnd: Date | null;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  /** ISO-4217 currency and amounts in minor units, when the provider reports them. */
  currency: string | null;
  grossAmountMinor: number | null;
  taxAmountMinor: number | null;
}

/** A verified store notification, normalized. Optional fields that are absent keep stored values. */
export interface ParsedNotification {
  eventId: string;
  /** When the store produced the event; older events than the stored state are skipped. */
  occurredAt: Date | null;
  originalTransactionId: string;
  /** A new billing transaction carried by the event (renewals), if any. */
  transactionId: string | null;
  status: StoredSubscriptionStatus;
  currentPeriodEnd?: Date;
  /** For renewals without an explicit period end: extend by one billing period. */
  extendOnePeriod?: boolean;
  autoRenew?: boolean;
  cancelAtPeriodEnd?: boolean;
  /** Marks the latest billing transaction as refunded. */
  refunded?: boolean;
}

export interface BillingVerifier {
  readonly provider: BillingProvider;
  /** Verifies a purchase proof from the app with the store. */
  verifyPurchase(productId: string, receipt: string): Promise<VerifiedSubscriptionState>;
  /** Verifies authenticity first, then parses a server notification. */
  parseNotification(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<ParsedNotification>;
}

export const BILLING_VERIFIER_LIST = Symbol('BILLING_VERIFIER_LIST');
