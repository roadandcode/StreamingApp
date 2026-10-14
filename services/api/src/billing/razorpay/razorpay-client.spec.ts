import { HttpRazorpayClient, UnconfiguredRazorpayClient } from './razorpay-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('HttpRazorpayClient', () => {
  const subscription = { id: 'sub_1', plan_id: 'plan_m', status: 'created', current_end: null };

  it('creates subscriptions with Basic auth and the plan, cycle count and notes', async () => {
    const fetchImpl = jest.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, subscription)));
    const client = new HttpRazorpayClient('rzp_key', 'rzp_secret', 'https://api.example.test/v1', fetchImpl);

    await expect(client.createSubscription({ planId: 'plan_m', totalCount: 120, notes: { userId: 'u1' } })).resolves.toEqual(
      subscription,
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.test/v1/subscriptions');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('rzp_key:rzp_secret').toString('base64')}`);
    expect(JSON.parse(init?.body as string)).toEqual({
      plan_id: 'plan_m',
      total_count: 120,
      customer_notify: 1,
      notes: { userId: 'u1' },
    });
  });

  it('fetches a subscription by id and refuses ids that are not Razorpay ids', async () => {
    const fetchImpl = jest.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(200, subscription)));
    const client = new HttpRazorpayClient('k', 's', 'https://api.example.test/v1', fetchImpl);
    await client.fetchSubscription('sub_1');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.test/v1/subscriptions/sub_1');
    await expect(client.fetchSubscription('../payments')).rejects.toMatchObject({ code: 'INVALID_PURCHASE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'INVALID_PURCHASE'],
    [404, 'INVALID_PURCHASE'],
    [401, 'PROVIDER_NOT_CONFIGURED'],
    [500, 'SERVICE_UNAVAILABLE'],
  ])('maps HTTP %i to %s without echoing the response', async (status, code) => {
    const client = new HttpRazorpayClient('k', 's', 'https://api.example.test/v1', () =>
      Promise.resolve(jsonResponse(status, { error: { description: 'secret detail' } })),
    );
    const error = (await client.fetchSubscription('sub_1').catch((e: unknown) => e)) as { code: string; message: string };
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('secret detail');
  });

  it('reports network failures as SERVICE_UNAVAILABLE', async () => {
    const client = new HttpRazorpayClient('k', 's', 'https://api.example.test/v1', () =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    await expect(client.fetchSubscription('sub_1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('UnconfiguredRazorpayClient', () => {
  it('fails closed', async () => {
    const client = new UnconfiguredRazorpayClient();
    await expect(client.createSubscription()).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    await expect(client.fetchSubscription()).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});
