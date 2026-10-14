import { AppException } from '../../common/errors';

/** The parts of Razorpay's subscription entity this backend uses (unix timestamps in seconds). */
export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  /** created | authenticated | active | pending | halted | cancelled | completed | expired | paused */
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  notes?: Record<string, string> | unknown[] | null;
}

export interface CreateRazorpaySubscription {
  planId: string;
  /** Number of billing cycles Razorpay will charge. */
  totalCount: number;
  notes: Record<string, string>;
}

/**
 * Razorpay REST API (https://api.razorpay.com/v1), behind an interface so tests can stub it.
 * Implementations throw AppException with a contract error code on failure.
 */
export interface RazorpayClient {
  createSubscription(input: CreateRazorpaySubscription): Promise<RazorpaySubscription>;
  fetchSubscription(subscriptionId: string): Promise<RazorpaySubscription>;
}

export const RAZORPAY_CLIENT = Symbol('RAZORPAY_CLIENT');

export const RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1';

/**
 * The parts of fetch this client uses, declared here so the code does not depend on which fetch
 * typings a build environment provides.
 */
interface HttpRequest {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init: HttpRequest) => Promise<HttpResponse>;

const globalFetch: FetchLike = (input, init) =>
  // Needed where the build's fetch typings declare a Response without ok/status/json.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  fetch(input, init) as unknown as Promise<HttpResponse>;

/** Plain-fetch client with HTTP Basic auth (key id and key secret). No SDK. */
export class HttpRazorpayClient implements RazorpayClient {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly baseUrl: string = RAZORPAY_API_BASE_URL,
    private readonly fetchImpl: FetchLike = globalFetch,
    private readonly timeoutMs = 10_000,
  ) {}

  createSubscription(input: CreateRazorpaySubscription): Promise<RazorpaySubscription> {
    return this.request<RazorpaySubscription>('POST', '/subscriptions', {
      plan_id: input.planId,
      total_count: input.totalCount,
      customer_notify: 1,
      notes: input.notes,
    });
  }

  fetchSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
    if (!/^[A-Za-z0-9_]+$/.test(subscriptionId)) {
      return Promise.reject(new AppException('INVALID_PURCHASE', 'Unknown Razorpay subscription.'));
    }
    return this.request<RazorpaySubscription>('GET', `/subscriptions/${subscriptionId}`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    let response: HttpResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppException('SERVICE_UNAVAILABLE', 'Razorpay could not be reached.');
    }
    if (response.ok) {
      return (await response.json()) as T;
    }
    // Never echo Razorpay's error body: it can contain request details.
    if (response.status === 401) {
      throw new AppException('PROVIDER_NOT_CONFIGURED', 'Razorpay rejected the API credentials.');
    }
    if (response.status === 400 || response.status === 404) {
      throw new AppException('INVALID_PURCHASE', 'Razorpay rejected the request.');
    }
    throw new AppException('SERVICE_UNAVAILABLE', 'Razorpay is unavailable.');
  }
}

/** Used when the Razorpay credentials are not configured: everything fails closed. */
export class UnconfiguredRazorpayClient implements RazorpayClient {
  createSubscription(): Promise<RazorpaySubscription> {
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }

  fetchSubscription(): Promise<RazorpaySubscription> {
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }
}
