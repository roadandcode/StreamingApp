import {
  type ApplyOutcome,
  type IncomingProviderEvent,
  isAlreadyHandled,
  processProviderEventOnce,
  type ProviderEventKey,
  type ProviderEventStatus,
  type ProviderEventStore,
} from './provider-event-dedupe';

interface Row {
  payloadHash: string;
  status: ProviderEventStatus;
  error: string | null;
}

/** In-memory store with transaction semantics: changes made inside a failed transaction are dropped. */
class InMemoryEventStore implements ProviderEventStore<Map<string, Row>> {
  rows = new Map<string, Row>();
  /** Stand-in for the business state a webhook mutates. */
  appliedCount = 0;

  private key(event: ProviderEventKey): string {
    return `${event.provider}:${event.eventId}`;
  }

  async transaction<T>(work: (tx: Map<string, Row>) => Promise<T>): Promise<T> {
    const draft = new Map([...this.rows].map(([k, v]) => [k, { ...v }]));
    const result = await work(draft);
    this.rows = draft;
    return result;
  }

  claim(tx: Map<string, Row>, event: IncomingProviderEvent): Promise<ProviderEventStatus | null> {
    const existing = tx.get(this.key(event));
    if (existing) return Promise.resolve(existing.status);
    tx.set(this.key(event), { payloadHash: event.payloadHash, status: 'received', error: null });
    return Promise.resolve(null);
  }

  complete(tx: Map<string, Row>, event: ProviderEventKey, outcome: ApplyOutcome): Promise<void> {
    const row = tx.get(this.key(event));
    if (row) row.status = outcome.status;
    return Promise.resolve();
  }

  recordFailure(event: IncomingProviderEvent, error: string): Promise<void> {
    this.rows.set(this.key(event), { payloadHash: event.payloadHash, status: 'failed', error });
    return Promise.resolve();
  }
}

const event: IncomingProviderEvent = { provider: 'fake', eventId: 'evt-1', payloadHash: 'abc' };

describe('processProviderEventOnce', () => {
  it('applies a new event once and reports repeats as duplicates', async () => {
    const store = new InMemoryEventStore();
    const apply = jest.fn(() => {
      store.appliedCount += 1;
      return Promise.resolve<ApplyOutcome>({ status: 'processed' });
    });

    await expect(processProviderEventOnce(store, event, apply)).resolves.toEqual({
      duplicate: false,
      outcome: { status: 'processed' },
    });
    await expect(processProviderEventOnce(store, event, apply)).resolves.toEqual({ duplicate: true });
    await expect(processProviderEventOnce(store, { ...event, payloadHash: 'different' }, apply)).resolves.toEqual({
      duplicate: true,
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(store.appliedCount).toBe(1);
    expect(store.rows.get('fake:evt-1')?.status).toBe('processed');
  });

  it('keys on provider and event id together', async () => {
    const store = new InMemoryEventStore();
    const apply = jest.fn(() => Promise.resolve<ApplyOutcome>({ status: 'processed' }));
    await processProviderEventOnce(store, event, apply);
    await processProviderEventOnce(store, { ...event, eventId: 'evt-2' }, apply);
    await processProviderEventOnce(store, { ...event, provider: 'apple' }, apply);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('treats skipped events as handled', async () => {
    const store = new InMemoryEventStore();
    const apply = jest.fn(() => Promise.resolve<ApplyOutcome>({ status: 'skipped', note: 'unknown subscription' }));
    await processProviderEventOnce(store, event, apply);
    await expect(processProviderEventOnce(store, event, apply)).resolves.toEqual({ duplicate: true });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('records a failure, keeps no partial state, and reprocesses the redelivery', async () => {
    const store = new InMemoryEventStore();
    const failing = jest.fn(() => Promise.reject(new Error('database went away')));
    await expect(processProviderEventOnce(store, event, failing)).rejects.toThrow('database went away');
    expect(store.rows.get('fake:evt-1')).toEqual({ payloadHash: 'abc', status: 'failed', error: 'database went away' });

    const apply = jest.fn(() => Promise.resolve<ApplyOutcome>({ status: 'processed' }));
    await expect(processProviderEventOnce(store, event, apply)).resolves.toEqual({
      duplicate: false,
      outcome: { status: 'processed' },
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('only processed and skipped count as handled', () => {
    expect(isAlreadyHandled(null)).toBe(false);
    expect(isAlreadyHandled('received')).toBe(false);
    expect(isAlreadyHandled('failed')).toBe(false);
    expect(isAlreadyHandled('processed')).toBe(true);
    expect(isAlreadyHandled('skipped')).toBe(true);
  });
});
