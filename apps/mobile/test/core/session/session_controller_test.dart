import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/api/api_providers.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/device/device_registrar.dart';
import 'package:streamingapp/core/session/session_controller.dart';
import 'package:streamingapp/core/storage/secure_store.dart';
import 'package:streamingapp/router.dart';

import '../../support/fakes.dart';

void main() {
  late MockStreamingApi api;
  late InMemoryKeyValueStore storage;

  setUpAll(registerFallbacks);

  setUp(() {
    api = MockStreamingApi();
    storage = InMemoryKeyValueStore();
    when(
      () => api.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    ).thenAnswer(
      (_) async => AuthResult(user: testUser(), tokens: testTokens()),
    );
    when(() => api.logout(any())).thenAnswer((_) async {});
  });

  ProviderContainer container() => ProviderContainer.test(
    retry: (_, _) => null,
    overrides: [
      keyValueStoreProvider.overrideWithValue(storage),
      streamingApiProvider.overrideWithValue(api),
      deviceIdentityProvider.overrideWithValue(FakeDeviceIdentity()),
    ],
  );

  void registerDeviceAnswers(Future<Device> Function() answer) {
    when(
      () => api.registerDevice(
        installationId: any(named: 'installationId'),
        platform: any(named: 'platform'),
        name: any(named: 'name'),
      ),
    ).thenAnswer((_) => answer());
  }

  Future<SessionController> signedOutController(ProviderContainer c) async {
    final controller = c.read(sessionControllerProvider.notifier);
    await pumpEventQueue(); // restore() finds no stored tokens
    expect(c.read(sessionControllerProvider).status, AuthStatus.signedOut);
    return controller;
  }

  test('sign-in stores tokens and registers this installation', () async {
    registerDeviceAnswers(() async => testDevice());
    final c = container();
    final controller = await signedOutController(c);

    await controller.signIn(
      email: 'viewer@example.com',
      password: 'correct-horse',
    );

    final state = c.read(sessionControllerProvider);
    expect(state.status, AuthStatus.signedIn);
    expect(state.deviceStatus, DeviceStatus.registered);
    expect(state.device?.id, 'device-1');
    expect(storage.values[SecureStore.tokensKey], contains('access-1'));

    final installationId = storage.values[SecureStore.installationIdKey];
    expect(installationId, isNotNull);
    verify(
      () => api.registerDevice(
        installationId: installationId!,
        platform: DevicePlatform.android,
        name: 'Test Phone',
      ),
    ).called(1);
    expect(sessionRedirect(state, '/login'), '/');
  });

  test('the installation id is generated once and reused', () async {
    final store = SecureStore(storage);
    final first = await store.installationId();
    final second = await SecureStore(storage).installationId();
    expect(first, second);
    expect(first, matches(RegExp(r'^[0-9a-f-]{36}$')));
  });

  test(
    '409 DEVICE_LIMIT_REACHED routes to the device-limit screen, then retries',
    () async {
      registerDeviceAnswers(
        () => Future.error(
          const ApiException(
            code: ApiErrorCode.deviceLimitReached,
            statusCode: 409,
            message: '',
          ),
        ),
      );
      final c = container();
      final controller = await signedOutController(c);
      await controller.signIn(
        email: 'viewer@example.com',
        password: 'correct-horse',
      );

      var state = c.read(sessionControllerProvider);
      expect(state.deviceStatus, DeviceStatus.limitReached);
      expect(sessionRedirect(state, '/'), '/device-limit');
      expect(sessionRedirect(state, '/device-limit'), isNull);

      // The user removed a device: registration now succeeds (200 or 201).
      registerDeviceAnswers(() async => testDevice());
      await controller.registerDevice();
      state = c.read(sessionControllerProvider);
      expect(state.deviceStatus, DeviceStatus.registered);
      expect(sessionRedirect(state, '/device-limit'), '/');
    },
  );

  test('403 DEVICE_REVOKED signs out with an explanation', () async {
    registerDeviceAnswers(
      () => Future.error(
        const ApiException(
          code: ApiErrorCode.deviceRevoked,
          statusCode: 403,
          message: '',
        ),
      ),
    );
    final c = container();
    final controller = await signedOutController(c);
    await controller.signIn(
      email: 'viewer@example.com',
      password: 'correct-horse',
    );

    final state = c.read(sessionControllerProvider);
    expect(state.status, AuthStatus.signedOut);
    expect(state.notice, SessionNotices.deviceRevoked);
    expect(storage.values.containsKey(SecureStore.tokensKey), isFalse);
    verify(() => api.logout('refresh-1')).called(1);
    expect(sessionRedirect(state, '/'), '/login');
  });

  test('restores a stored session on launch', () async {
    await SecureStore(storage).writeTokens(testTokens());
    when(() => api.me()).thenAnswer((_) async => testUser());
    registerDeviceAnswers(() async => testDevice());

    final c = container();
    expect(c.read(sessionControllerProvider).status, AuthStatus.restoring);
    expect(sessionRedirect(c.read(sessionControllerProvider), '/'), '/splash');
    await pumpEventQueue();

    final state = c.read(sessionControllerProvider);
    expect(state.status, AuthStatus.signedIn);
    expect(state.device?.id, 'device-1');
  });

  test('session expiry from the API client signs out with a notice', () async {
    registerDeviceAnswers(() async => testDevice());
    final c = container();
    final controller = await signedOutController(c);
    await controller.signIn(
      email: 'viewer@example.com',
      password: 'correct-horse',
    );

    controller.onSessionExpired();
    final state = c.read(sessionControllerProvider);
    expect(state.status, AuthStatus.signedOut);
    expect(state.notice, SessionNotices.sessionExpired);
  });
}
