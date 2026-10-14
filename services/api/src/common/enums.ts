import {
  accessTierEnum,
  accountStatusEnum,
  billingPeriodEnum,
  billingProviderEnum,
  contentKindEnum,
  platformEnum,
  processingStatusEnum,
  publicationStatusEnum,
  roleEnum,
  subscriptionStatusEnum,
} from '../database/schema';

/** Enum value lists shared by validation and the OpenAPI document. */
export const ROLES = roleEnum.enumValues;
export const ACCOUNT_STATUSES = accountStatusEnum.enumValues;
export const CONTENT_KINDS = contentKindEnum.enumValues;
export const ACCESS_TIERS = accessTierEnum.enumValues;
export const PUBLICATION_STATUSES = publicationStatusEnum.enumValues;
export const PROCESSING_STATUSES = processingStatusEnum.enumValues;
export const PLATFORMS = platformEnum.enumValues;
export const BILLING_PROVIDERS = billingProviderEnum.enumValues;
export const BILLING_PERIODS = billingPeriodEnum.enumValues;
/** `none` is a view value for users who never subscribed; it is never stored. */
export const SUBSCRIPTION_STATUSES = ['none', ...subscriptionStatusEnum.enumValues] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
