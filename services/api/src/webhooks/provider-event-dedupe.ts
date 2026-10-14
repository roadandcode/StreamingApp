import type { BillingProvider } from '../database/schema';

/**
 * Exactly-once application of provider events (store notifications).
 *
 * Inside one transaction the event is claimed in `provider_events` keyed by `(provider, eventId)`,
 * applied, and marked processed. A repeat of an event that was already processed (or deliberately
 * skipped) is reported as a duplicate and not applied again. If applying fails, the transaction rolls
 * back, the failure is recorded outside it, and a later redelivery is processed again.
 */
export interface ProviderEventKey {
  provider: BillingProvider;
  eventId: string;
}

export interface IncomingProviderEvent extends ProviderEventKey {
  payloadHash: string;
}

export type ProviderEventStatus = 'received' | 'processed' | 'skipped' | 'failed';

/** What applying an event did: `processed` changed state, `skipped` was a valid no-op. */
export interface ApplyOutcome {
  status: 'processed' | 'skipped';
  note?: string;
}

export interface ProviderEventStore<Tx> {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Inserts the event, or locks the existing row. Returns the status of an existing row, or `null`
   * when this call inserted it.
   */
  claim(tx: Tx, event: IncomingProviderEvent, now: Date): Promise<ProviderEventStatus | null>;
  complete(tx: Tx, key: ProviderEventKey, outcome: ApplyOutcome, now: Date): Promise<void>;
  /** Records a failure outside the rolled-back transaction. */
  recordFailure(event: IncomingProviderEvent, error: string, now: Date): Promise<void>;
}

/** An event already handled must not be applied again; received/failed ones are (re)processed. */
export function isAlreadyHandled(status: ProviderEventStatus | null): boolean {
  return status === 'processed' || status === 'skipped';
}

export interface DedupeResult {
  duplicate: boolean;
  outcome?: ApplyOutcome;
}

export async function processProviderEventOnce<Tx>(
  store: ProviderEventStore<Tx>,
  event: IncomingProviderEvent,
  apply: (tx: Tx) => Promise<ApplyOutcome>,
  clock: () => Date = () => new Date(),
): Promise<DedupeResult> {
  try {
    return await store.transaction(async (tx) => {
      const existing = await store.claim(tx, event, clock());
      if (isAlreadyHandled(existing)) {
        return { duplicate: true };
      }
      const outcome = await apply(tx);
      await store.complete(tx, event, outcome, clock());
      return { duplicate: false, outcome };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.recordFailure(event, message.slice(0, 1000), clock()).catch(() => undefined);
    throw error;
  }
}
