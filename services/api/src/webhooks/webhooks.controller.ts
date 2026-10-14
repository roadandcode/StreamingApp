import { Controller, HttpCode, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { FAKE_EVENT_TYPES } from '../billing/fake-billing-verifier';
import { ApiErrors } from '../common/api-docs';
import { Public } from '../common/request-context';
import { WebhooksService } from './webhooks.service';

export class WebhookAckDto {
  @ApiProperty({ description: 'True when this event id was already processed; nothing was re-applied.' })
  duplicate: boolean;
}

class FakeWebhookEventDto {
  @ApiProperty({ example: 'evt-0001' })
  eventId: string;

  @ApiProperty({ enum: FAKE_EVENT_TYPES, enumName: 'FakeWebhookEventType' })
  type: string;

  @ApiProperty({ example: 'fake-txn-0001' })
  originalTransactionId: string;

  @ApiProperty({ required: false, format: 'date-time', description: 'New period end, when the event has one.' })
  expiresAt?: string;
}

@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class StoreWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('apple')
  @HttpCode(200)
  @ApiOperation({ summary: 'App Store Server Notifications v2 (not configured yet)' })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrors('INVALID_SIGNATURE', 'PROVIDER_NOT_CONFIGURED')
  apple(@Req() request: RawBodyRequest<Request>): Promise<WebhookAckDto> {
    return this.webhooks.handle('apple', request.rawBody, request.headers);
  }

  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Google Play Real-time Developer Notifications via Pub/Sub push (not configured yet)' })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrors('INVALID_SIGNATURE', 'PROVIDER_NOT_CONFIGURED')
  google(@Req() request: RawBodyRequest<Request>): Promise<WebhookAckDto> {
    return this.webhooks.handle('google', request.rawBody, request.headers);
  }

  @Post('razorpay')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Razorpay webhooks (web subscriptions)',
    description:
      'X-Razorpay-Signature is the hex HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET; the event ' +
      'id comes from X-Razorpay-Event-Id. Returns 503 when Razorpay is not configured.',
  })
  @ApiHeader({ name: 'X-Razorpay-Signature', required: true })
  @ApiHeader({ name: 'X-Razorpay-Event-Id', required: true })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrors('VALIDATION_FAILED', 'INVALID_SIGNATURE', 'PROVIDER_NOT_CONFIGURED')
  razorpay(@Req() request: RawBodyRequest<Request>): Promise<WebhookAckDto> {
    return this.webhooks.handle('razorpay', request.rawBody, request.headers);
  }
}

/** Mounted only when BILLING_MODE=fake outside production. */
@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class FakeWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('fake')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Simulated store notification (development only)',
    description:
      'Only mounted when BILLING_MODE=fake and NODE_ENV is not production. `X-Fake-Signature` is the hex ' +
      'HMAC-SHA256 of the raw body with FAKE_WEBHOOK_SECRET.',
  })
  @ApiHeader({ name: 'X-Fake-Signature', required: true })
  @ApiBody({ type: FakeWebhookEventDto })
  @ApiOkResponse({ type: WebhookAckDto })
  @ApiErrors('VALIDATION_FAILED', 'INVALID_SIGNATURE')
  fake(@Req() request: RawBodyRequest<Request>): Promise<WebhookAckDto> {
    return this.webhooks.handle('fake', request.rawBody, request.headers);
  }
}
