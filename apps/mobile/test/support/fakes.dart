import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:mocktail/mocktail.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/api/streaming_api.dart';
import 'package:streamingapp/core/config.dart';
import 'package:streamingapp/core/device/device_identity.dart';

class MockStreamingApi extends Mock implements StreamingApi {}

void registerFallbacks() {
  registerFallbackValue(DevicePlatform.android);
  registerFallbackValue(BillingProvider.fake);
}

const testConfig = AppConfig(apiBaseUrl: 'http://api.test');

// Wire-format fixtures ---------------------------------------------------------

Map<String, dynamic> tokensJson({
  String access = 'access-1',
  String refresh = 'refresh-1',
}) => {
  'accessToken': access,
  'accessTokenExpiresAt': '2026-11-12T00:15:00.000Z',
  'refreshToken': refresh,
  'refreshTokenExpiresAt': '2026-12-12T00:00:00.000Z',
};

Tokens testTokens({String access = 'access-1', String refresh = 'refresh-1'}) =>
    Tokens.fromJson(tokensJson(access: access, refresh: refresh));

Map<String, dynamic> userJson({String id = 'user-1'}) => {
  'id': id,
  'email': 'viewer@example.com',
  'displayName': 'Asha',
  'role': 'viewer',
  'accountStatus': 'active',
  'createdAt': '2026-11-01T10:00:00.000Z',
};

User testUser() => User.fromJson(userJson());

Device testDevice({String id = 'device-1', String installationId = 'inst-1'}) =>
    Device.fromJson({
      'id': id,
      'installationId': installationId,
      'platform': 'android',
      'name': 'Test Phone',
      'lastSeenAt': '2026-11-12T00:00:00.000Z',
      'createdAt': '2026-11-01T00:00:00.000Z',
      'revokedAt': null,
    });

SubscriptionView subscriptionView({bool hasAccess = false}) =>
    SubscriptionView.fromJson({
      'status': hasAccess ? 'active' : 'none',
      'hasAccess': hasAccess,
      'accessTier': hasAccess ? 'premium' : null,
      'planCode': hasAccess ? 'premium_monthly' : null,
      'provider': hasAccess ? 'fake' : null,
      'accessUntil': hasAccess ? '2026-12-12T00:00:00.000Z' : null,
      'autoRenewEnabled': hasAccess,
    });

Plan premiumPlan() => Plan.fromJson({
  'code': 'premium_monthly',
  'name': 'Premium Monthly',
  'billingPeriod': 'P1M',
  'accessTier': 'premium',
  'storeProducts': [
    {'provider': 'google', 'productId': 'premium_monthly_play'},
    {'provider': 'apple', 'productId': 'premium_monthly_ios'},
    {'provider': 'fake', 'productId': 'fake_premium_monthly'},
  ],
});

PlaybackAuthorization playbackAuthorization({
  String sessionId = 'session-1',
  int heartbeatIntervalSeconds = 30,
  DateTime? expiresAt,
  Map<String, dynamic>? drm,
}) => PlaybackAuthorization.fromJson({
  'playbackSessionId': sessionId,
  'contentId': 'content-1',
  'manifestUrl':
      'http://api.test/v1/dev/media/asset/manifest.m3u8?sid=$sessionId&exp=1&sig=ab',
  'expiresAt': (expiresAt ?? DateTime.utc(2100)).toIso8601String(),
  'heartbeatIntervalSeconds': heartbeatIntervalSeconds,
  'drm': drm,
});

// HTTP -------------------------------------------------------------------------

typedef FakeHandler = Future<ResponseBody> Function(RequestOptions options);

/// Answers dio requests in memory so no network is needed.
class FakeHttpAdapter implements HttpClientAdapter {
  FakeHttpAdapter(this.handler);

  final FakeHandler handler;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonResponse(int status, Object? body) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  },
);

ResponseBody errorResponse(int status, String code, [String message = '']) =>
    jsonResponse(status, {
      'statusCode': status,
      'code': code,
      'message': message,
    });

// Device -----------------------------------------------------------------------

class FakeDeviceIdentity extends DeviceIdentity {
  FakeDeviceIdentity() : super(platform: TargetPlatform.android);

  @override
  Future<String> deviceName() async => 'Test Phone';
}
