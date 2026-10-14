import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:streamingapp/core/api/api_client.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/api/streaming_api.dart';
import 'package:streamingapp/core/storage/secure_store.dart';

import '../../support/fakes.dart';

/// Checks the request shapes the app sends against the contract.
void main() {
  late List<RequestOptions> requests;
  late StreamingApi api;

  setUp(() async {
    final store = SecureStore(InMemoryKeyValueStore());
    await store.writeTokens(testTokens());
    final adapter = FakeHttpAdapter((options) async {
      switch (options.path) {
        case '/v1/playback/sessions':
          return jsonResponse(201, {
            'playbackSessionId': 'session-1',
            'contentId': 'content-1',
            'manifestUrl': 'http://api.test/manifest.m3u8',
            'expiresAt': '2026-11-12T00:05:00.000Z',
            'heartbeatIntervalSeconds': 30,
            'drm': null,
          });
        case '/v1/playback/sessions/session-1/heartbeat':
          return jsonResponse(200, {'expiresAt': '2026-11-12T00:10:00.000Z'});
        case '/v1/me/devices':
          return jsonResponse(200, {
            'id': 'device-1',
            'installationId': 'inst-1',
            'platform': 'android',
            'name': 'Test Phone',
            'lastSeenAt': '2026-11-12T00:00:00.000Z',
            'createdAt': '2026-11-01T00:00:00.000Z',
            'revokedAt': null,
          });
        case '/v1/purchases/verify':
          return jsonResponse(200, {
            'status': 'active',
            'hasAccess': true,
            'accessTier': 'premium',
            'planCode': 'premium_monthly',
            'provider': 'google',
            'accessUntil': '2026-12-12T00:00:00.000Z',
            'autoRenewEnabled': true,
          });
        case '/v1/auth/register':
          return jsonResponse(201, {
            'user': userJson(),
            'tokens': tokensJson(),
          });
      }
      return jsonResponse(204, null);
    });
    requests = adapter.requests;
    api = StreamingApi(
      ApiClient(
        baseUrl: 'http://api.test',
        tokenStore: store,
        httpClientAdapter: adapter,
      ),
    );
  });

  RequestOptions lastRequest() => requests.last;

  test(
    'POST /v1/playback/sessions sends contentId, deviceId and supportedDrm',
    () async {
      final auth = await api.startPlayback(
        contentId: 'content-1',
        deviceId: 'device-1',
        supportedDrm: const [DrmSystem.widevine],
      );
      expect(auth.playbackSessionId, 'session-1');
      expect(lastRequest().method, 'POST');
      expect(lastRequest().data, {
        'contentId': 'content-1',
        'deviceId': 'device-1',
        'supportedDrm': ['widevine'],
      });
      expect(lastRequest().headers['Authorization'], 'Bearer access-1');
    },
  );

  test('heartbeat sends the position and returns the new expiry', () async {
    final expiresAt = await api.heartbeat('session-1', positionSeconds: 95);
    expect(lastRequest().data, {'positionSeconds': 95});
    expect(expiresAt, DateTime.utc(2026, 11, 12, 0, 10));
  });

  test('ending a session is a DELETE', () async {
    await api.endPlayback('session-1');
    expect(lastRequest().method, 'DELETE');
    expect(lastRequest().path, '/v1/playback/sessions/session-1');
  });

  test('device registration body', () async {
    final device = await api.registerDevice(
      installationId: 'inst-1',
      platform: DevicePlatform.android,
      name: 'Test Phone',
    );
    expect(device.id, 'device-1');
    expect(lastRequest().data, {
      'installationId': 'inst-1',
      'platform': 'android',
      'name': 'Test Phone',
    });
  });

  test('purchase verification sends provider, productId and receipt', () async {
    final view = await api.verifyPurchase(
      provider: BillingProvider.google,
      productId: 'premium_monthly_play',
      receipt: 'play-token',
    );
    expect(view.hasAccess, isTrue);
    expect(lastRequest().data, {
      'provider': 'google',
      'productId': 'premium_monthly_play',
      'receipt': 'play-token',
    });
  });

  test(
    'registration omits an empty display name (unknown fields are rejected)',
    () async {
      await api.register(
        email: 'a@b.co',
        password: '1234567890',
        displayName: '',
      );
      expect(lastRequest().data, {'email': 'a@b.co', 'password': '1234567890'});
      expect(lastRequest().headers['Authorization'], isNull);
    },
  );
}
