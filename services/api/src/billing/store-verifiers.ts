import type { IncomingHttpHeaders } from 'node:http';
import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors';
import type { BillingVerifier, ParsedNotification, VerifiedSubscriptionState } from './billing-verifier';

/**
 * App Store verifier. Not configured yet: fails closed with `503 PROVIDER_NOT_CONFIGURED` and never
 * grants access.
 */
@Injectable()
export class AppleBillingVerifier implements BillingVerifier {
  readonly provider = 'apple' as const;

  verifyPurchase(productId: string, receipt: string): Promise<VerifiedSubscriptionState> {
    void productId;
    void receipt;
    // TODO: verify the app's `signedTransactionInfo` JWS with the App Store Server API through
    //   @apple/app-store-server-library (SignedDataVerifier with Apple's root certificates, bundle id,
    //   environment), then call Get All Subscription Statuses for the original transaction id and map
    //   the latest renewal info (expiresDate, gracePeriodExpiresDate, autoRenewStatus, revocationDate)
    //   onto VerifiedSubscriptionState. Credentials: issuer id, key id and private key from the secret
    //   manager.
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }

  parseNotification(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<ParsedNotification> {
    void rawBody;
    void headers;
    // TODO: App Store Server Notifications v2: verify the `signedPayload` JWS with
    //   @apple/app-store-server-library, use `notificationUUID` as the event id and `signedDate` as
    //   occurredAt, and map notificationType/subtype (SUBSCRIBED, DID_RENEW, DID_CHANGE_RENEWAL_STATUS,
    //   DID_FAIL_TO_RENEW with GRACE_PERIOD, EXPIRED, GRACE_PERIOD_EXPIRED, REFUND, REVOKE) to statuses.
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }
}

/**
 * Google Play verifier. Not configured yet: fails closed with `503 PROVIDER_NOT_CONFIGURED` and never
 * grants access.
 */
@Injectable()
export class GoogleBillingVerifier implements BillingVerifier {
  readonly provider = 'google' as const;

  verifyPurchase(productId: string, receipt: string): Promise<VerifiedSubscriptionState> {
    void productId;
    void receipt;
    // TODO: call the Google Play Developer API `purchases.subscriptionsv2.get` with the purchase
    //   token (service account from the secret manager), map subscriptionState
    //   (ACTIVE, IN_GRACE_PERIOD, ON_HOLD, PAUSED, CANCELED, EXPIRED, PENDING) and lineItems[].expiryTime,
    //   and acknowledge the purchase (purchases.subscriptions.acknowledge) after storing it.
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }

  parseNotification(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<ParsedNotification> {
    void rawBody;
    void headers;
    // TODO: Real-time Developer Notifications (RTDN) via Pub/Sub push: verify the push request's
    //   OIDC token (audience and service account), decode `message.data`, use `message.messageId` as
    //   the event id and `eventTimeMillis` as occurredAt, then re-fetch the authoritative state with
    //   `purchases.subscriptionsv2.get` instead of trusting the notification type alone.
    return Promise.reject(new AppException('PROVIDER_NOT_CONFIGURED'));
  }
}
