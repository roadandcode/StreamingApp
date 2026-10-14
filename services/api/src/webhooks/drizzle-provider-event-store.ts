import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database, Executor } from '../database/database.types';
import { providerEvents } from '../database/schema';
import type {
  ApplyOutcome,
  IncomingProviderEvent,
  ProviderEventKey,
  ProviderEventStatus,
  ProviderEventStore,
} from './provider-event-dedupe';

export function hashPayload(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

const byKey = (key: ProviderEventKey) =>
  and(eq(providerEvents.provider, key.provider), eq(providerEvents.eventId, key.eventId));

/** `provider_events` backed store for processProviderEventOnce. */
export class DrizzleProviderEventStore implements ProviderEventStore<Executor> {
  constructor(private readonly db: Database) {}

  transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx));
  }

  async claim(tx: Executor, event: IncomingProviderEvent, now: Date): Promise<ProviderEventStatus | null> {
    const inserted = await tx
      .insert(providerEvents)
      .values({
        provider: event.provider,
        eventId: event.eventId,
        payloadHash: event.payloadHash,
        receivedAt: now,
        processingStatus: 'received',
      })
      .onConflictDoNothing({ target: [providerEvents.provider, providerEvents.eventId] })
      .returning({ id: providerEvents.id });
    if (inserted.length > 0) return null;
    // Already known: lock it so a concurrent redelivery waits for this one to finish.
    const [existing] = await tx
      .select({ status: providerEvents.processingStatus })
      .from(providerEvents)
      .where(byKey(event))
      .for('update')
      .limit(1);
    return (existing?.status as ProviderEventStatus | undefined) ?? null;
  }

  async complete(tx: Executor, key: ProviderEventKey, outcome: ApplyOutcome, now: Date): Promise<void> {
    await tx
      .update(providerEvents)
      .set({ processingStatus: outcome.status, processedAt: now, error: outcome.note ?? null })
      .where(byKey(key));
  }

  async recordFailure(event: IncomingProviderEvent, error: string, now: Date): Promise<void> {
    await this.db
      .insert(providerEvents)
      .values({
        provider: event.provider,
        eventId: event.eventId,
        payloadHash: event.payloadHash,
        receivedAt: now,
        processingStatus: 'failed',
        error,
      })
      .onConflictDoUpdate({
        target: [providerEvents.provider, providerEvents.eventId],
        set: { processingStatus: 'failed', error },
      });
  }
}
