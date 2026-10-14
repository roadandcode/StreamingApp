import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:streamingapp/core/api/api_client.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/storage/secure_store.dart';

import '../../support/fakes.dart';

void main() {
  late InMemoryKeyValueStore storage;
  late SecureStore store;
  late int refreshCalls;
  late int sessionExpiredCalls;

  setUp(() async {
    storage = InMemoryKeyValueStore();
    store = SecureStore(storage);
    await store.writeTokens(
      testTokens(access: 'old-access', refresh: 'old-refresh'),
    );
    refreshCalls = 0;
    sessionExpiredCalls = 0;
  });

  ApiClient clientWith(FakeHandler handler) => ApiClient(
    baseUrl: 'http://api.test',
    tokenStore: store,
    httpClientAdapter: FakeHttpAdapter(handler),
    onSessionExpired: () => sessionExpiredCalls++,
  );

  /// Protected endpoints accept only the new access token.
  Future<ResponseBody> protectedEndpoint(RequestOptions options) async {
    if (options.headers['Authorization'] == 'Bearer new-access') {
      return jsonResponse(200, {'path': options.path});
    }
    return errorResponse(401, ApiErrorCode.unauthenticated, 'Token expired');
  }

  test('adds the bearer token to authenticated requests only', () async {
    final seen = <String, Object?>{};
    final client = clientWith((options) async {
      seen[options.path] = options.headers['Authorization'];
      return jsonResponse(200, {'ok': true});
    });

    await client.get('/v1/me');
    await client.get('/v1/catalog', authenticated: false);

    expect(seen['/v1/me'], 'Bearer old-access');
    expect(seen['/v1/catalog'], isNull);
  });

  test('concurrent 401s share a single refresh, persist the rotated tokens '
      'and retry each request once', () async {
    final refreshGate = Completer<void>();
    final sent = <String, int>{};
    final client = clientWith((options) async {
      if (options.path == '/v1/auth/refresh') {
        refreshCalls++;
        expect(options.data, {'refreshToken': 'old-refresh'});
        expect(options.headers['Authorization'], isNull);
        await refreshGate.future;
        return jsonResponse(200, {
          'tokens': tokensJson(access: 'new-access', refresh: 'new-refresh'),
        });
      }
      sent[options.path] = (sent[options.path] ?? 0) + 1;
      return protectedEndpoint(options);
    });

    final results = Future.wait([
      client.get('/v1/me'),
      client.get('/v1/me/subscription'),
      client.get('/v1/me/devices'),
    ]);
    // Let all three fail with 401 while the refresh is still in flight.
    await pumpEventQueue();
    refreshGate.complete();

    final bodies = await results;
    expect(refreshCalls, 1);
    expect(bodies.map((b) => (b! as Map)['path']), [
      '/v1/me',
      '/v1/me/subscription',
      '/v1/me/devices',
    ]);
    expect(sent, {'/v1/me': 2, '/v1/me/subscription': 2, '/v1/me/devices': 2});

    // Rotated tokens are persisted to secure storage, not just memory.
    final reloaded = await SecureStore(storage).readTokens();
    expect(reloaded?.accessToken, 'new-access');
    expect(reloaded?.refreshToken, 'new-refresh');
    expect(sessionExpiredCalls, 0);
  });

  test(
    'a 401 that arrives after a refresh retries without refreshing again',
    () async {
      final slowGate = Completer<void>();
      final client = clientWith((options) async {
        if (options.path == '/v1/auth/refresh') {
          refreshCalls++;
          return jsonResponse(200, {
            'tokens': tokensJson(access: 'new-access', refresh: 'new-refresh'),
          });
        }
        if (options.path == '/v1/slow' &&
            options.headers['Authorization'] == 'Bearer old-access') {
          await slowGate.future; // answered after the refresh completed
        }
        return protectedEndpoint(options);
      });

      final slow = client.get('/v1/slow');
      await client.get('/v1/fast'); // triggers and completes the refresh
      slowGate.complete();

      expect(await slow, {'path': '/v1/slow'});
      expect(refreshCalls, 1);
    },
  );

  test('retries only once: a second 401 is returned, not looped', () async {
    final client = clientWith((options) async {
      if (options.path == '/v1/auth/refresh') {
        refreshCalls++;
        return jsonResponse(200, {
          'tokens': tokensJson(access: 'new-access', refresh: 'new-refresh'),
        });
      }
      return errorResponse(401, ApiErrorCode.unauthenticated);
    });

    await expectLater(
      client.get('/v1/me'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', ApiErrorCode.unauthenticated)
            .having((e) => e.statusCode, 'statusCode', 401),
      ),
    );
    expect(refreshCalls, 1);
  });

  test(
    'a rejected refresh clears the session once and fails the requests',
    () async {
      final client = clientWith((options) async {
        if (options.path == '/v1/auth/refresh') {
          refreshCalls++;
          return errorResponse(401, ApiErrorCode.invalidRefreshToken);
        }
        return protectedEndpoint(options);
      });

      final results = await Future.wait([
        client.get('/v1/me').then<Object?>((v) => v, onError: (Object e) => e),
        client
            .get('/v1/me/devices')
            .then<Object?>((v) => v, onError: (Object e) => e),
      ]);

      for (final result in results) {
        expect(
          result,
          isA<ApiException>().having(
            (e) => e.code,
            'code',
            ApiErrorCode.unauthenticated,
          ),
        );
      }
      expect(refreshCalls, 1);
      expect(sessionExpiredCalls, 1);
      expect(await store.readTokens(), isNull);
      expect(await SecureStore(storage).readTokens(), isNull);
    },
  );

  test('a refresh that cannot reach the server keeps the session', () async {
    final client = clientWith((options) async {
      if (options.path == '/v1/auth/refresh') {
        refreshCalls++;
        throw const SocketException('offline');
      }
      return protectedEndpoint(options);
    });

    await expectLater(
      client.get('/v1/me'),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          ApiErrorCode.networkError,
        ),
      ),
    );
    expect(sessionExpiredCalls, 0);
    expect((await store.readTokens())?.refreshToken, 'old-refresh');
  });

  test('other 401 codes (wrong password) never trigger a refresh', () async {
    final client = clientWith((options) async {
      if (options.path == '/v1/auth/refresh') refreshCalls++;
      return errorResponse(
        401,
        ApiErrorCode.invalidCredentials,
        'Wrong email or password',
      );
    });

    await expectLater(
      client.post(
        '/v1/auth/login',
        body: {'email': 'a@b.co', 'password': 'x'},
        authenticated: false,
      ),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          ApiErrorCode.invalidCredentials,
        ),
      ),
    );
    await expectLater(
      client.get('/v1/me'),
      throwsA(
        isA<ApiException>().having(
          (e) => e.code,
          'code',
          ApiErrorCode.invalidCredentials,
        ),
      ),
    );
    expect(refreshCalls, 0);
  });

  test(
    'error bodies become ApiException with code, status and message',
    () async {
      final client = clientWith(
        (options) async => errorResponse(
          403,
          ApiErrorCode.entitlementRequired,
          'An active subscription is required to watch this content.',
        ),
      );

      await expectLater(
        client.post(
          '/v1/playback/sessions',
          body: {'contentId': 'c', 'deviceId': 'd'},
        ),
        throwsA(
          isA<ApiException>()
              .having((e) => e.code, 'code', ApiErrorCode.entitlementRequired)
              .having((e) => e.statusCode, 'statusCode', 403)
              .having((e) => e.message, 'message', contains('subscription')),
        ),
      );
    },
  );
}
