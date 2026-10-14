import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/config.dart';
import 'package:streamingapp/features/player/native_drm_player.dart';
import 'package:streamingapp/features/player/playback_controller.dart';
import 'package:streamingapp/features/player/protected_player.dart';

import '../../support/fakes.dart';
import '../../support/player_fakes.dart';

ApiException forbidden(String code) =>
    ApiException(code: code, statusCode: 403, message: 'stop');

void main() {
  late MockStreamingApi api;
  late FakePlayer player;
  late FakePlayerFactory fakeFactory;

  setUp(() {
    api = MockStreamingApi();
    player = FakePlayer();
    fakeFactory = FakePlayerFactory(player);
    when(
      () => api.startPlayback(
        contentId: 'content-1',
        deviceId: 'device-1',
        supportedDrm: const [DrmSystem.widevine],
      ),
    ).thenAnswer((_) async => playbackAuthorization());
    when(
      () =>
          api.heartbeat(any(), positionSeconds: any(named: 'positionSeconds')),
    ).thenAnswer((_) async => DateTime.utc(2100));
    when(() => api.endPlayback(any())).thenAnswer((_) async {});
  });

  PlaybackController controllerFor({
    ProtectedPlayerFactory? playerFactory,
    DateTime Function()? clock,
  }) => PlaybackController(
    contentId: 'content-1',
    api: api,
    playerFactory: playerFactory ?? fakeFactory,
    resolveDeviceId: () async => 'device-1',
    clock: clock,
  );

  void heartbeatFails(Object error) {
    when(
      () =>
          api.heartbeat(any(), positionSeconds: any(named: 'positionSeconds')),
    ).thenAnswer((_) => Future.error(error));
  }

  test('plays the authorization and sends heartbeats with the position', () {
    fakeAsync((async) {
      final controller = controllerFor();
      controller.start();
      async.flushMicrotasks();

      expect(controller.phase, PlaybackPhase.ready);
      expect(player.playing, isTrue);
      expect(player.initializedWith?.playbackSessionId, 'session-1');

      player.currentPosition = const Duration(seconds: 42);
      async.elapse(const Duration(seconds: 30));
      verify(() => api.heartbeat('session-1', positionSeconds: 42)).called(1);
      async.elapse(const Duration(seconds: 30));
      verify(
        () => api.heartbeat(
          'session-1',
          positionSeconds: any(named: 'positionSeconds'),
        ),
      ).called(1);

      controller.dispose();
      async.flushMicrotasks();
      verify(() => api.endPlayback('session-1')).called(1);
      expect(player.disposed, isTrue);
    });
  });

  for (final code in [
    ApiErrorCode.concurrentStreamLimit,
    ApiErrorCode.deviceRevoked,
    ApiErrorCode.playbackSessionEnded,
    ApiErrorCode.accountInactive,
  ]) {
    test('a 403 $code heartbeat stops the player immediately', () {
      fakeAsync((async) {
        final controller = controllerFor();
        controller.start();
        async.flushMicrotasks();
        expect(player.playing, isTrue);

        heartbeatFails(forbidden(code));
        async.elapse(const Duration(seconds: 30));

        expect(player.stopped, isTrue);
        expect(player.playing, isFalse);
        expect(controller.phase, PlaybackPhase.stopped);
        expect(controller.errorCode, code);
        expect(controller.errorMessage, isNotEmpty);
        expect(controller.requiresSubscription, isFalse);
        expect(controller.deviceRevoked, code == ApiErrorCode.deviceRevoked);

        // No more heartbeats after the stop.
        async.elapse(const Duration(minutes: 5));
        verify(
          () => api.heartbeat(
            any(),
            positionSeconds: any(named: 'positionSeconds'),
          ),
        ).called(1);

        // The server already ended the session: no DELETE needed.
        controller.dispose();
        async.flushMicrotasks();
        verifyNever(() => api.endPlayback(any()));
      });
    });
  }

  test(
    'ENTITLEMENT_REQUIRED on a heartbeat stops and asks for the paywall',
    () {
      fakeAsync((async) {
        final controller = controllerFor();
        controller.start();
        async.flushMicrotasks();

        heartbeatFails(forbidden(ApiErrorCode.entitlementRequired));
        async.elapse(const Duration(seconds: 30));

        expect(player.stopped, isTrue);
        expect(controller.requiresSubscription, isTrue);
        expect(controller.canRetry, isFalse);
        controller.dispose();
      });
    },
  );

  test('ENTITLEMENT_REQUIRED when starting never creates a player', () {
    fakeAsync((async) {
      when(
        () => api.startPlayback(
          contentId: 'content-1',
          deviceId: 'device-1',
          supportedDrm: const [DrmSystem.widevine],
        ),
      ).thenAnswer(
        (_) => Future.error(forbidden(ApiErrorCode.entitlementRequired)),
      );

      final controller = controllerFor();
      controller.start();
      async.flushMicrotasks();

      expect(fakeFactory.created, 0);
      expect(controller.phase, PlaybackPhase.stopped);
      expect(controller.requiresSubscription, isTrue);
      controller.dispose();
      async.flushMicrotasks();
      verifyNever(() => api.endPlayback(any()));
    });
  });

  test('transient heartbeat failures are tolerated only until the authorization expires', () {
    final start = DateTime.utc(2026, 11, 12, 10);
    fakeAsync((async) {
      when(
        () => api.startPlayback(
          contentId: 'content-1',
          deviceId: 'device-1',
          supportedDrm: const [DrmSystem.widevine],
        ),
      ).thenAnswer(
        (_) async => playbackAuthorization(
          expiresAt: start.add(const Duration(seconds: 100)),
        ),
      );
      final controller = controllerFor(clock: () => start.add(async.elapsed));
      controller.start();
      async.flushMicrotasks();

      heartbeatFails(
        const ApiException(
          code: ApiErrorCode.networkError,
          statusCode: null,
          message: '',
        ),
      );
      async.elapse(const Duration(seconds: 90));
      expect(controller.phase, PlaybackPhase.ready);
      expect(player.playing, isTrue);

      async.elapse(const Duration(seconds: 30)); // past expiresAt
      expect(controller.phase, PlaybackPhase.stopped);
      expect(player.stopped, isTrue);
      expect(controller.canRetry, isTrue);
      verify(() => api.endPlayback('session-1')).called(1);
      controller.dispose();
    });
  });

  test(
    'backgrounding pauses and stops heartbeats; resuming re-validates at once',
    () {
      fakeAsync((async) {
        final controller = controllerFor();
        controller.start();
        async.flushMicrotasks();

        controller.onAppBackgrounded();
        async.flushMicrotasks();
        expect(player.playing, isFalse);
        async.elapse(const Duration(minutes: 3));
        verifyNever(
          () => api.heartbeat(
            any(),
            positionSeconds: any(named: 'positionSeconds'),
          ),
        );

        heartbeatFails(forbidden(ApiErrorCode.playbackSessionEnded));
        controller.onAppResumed();
        async.flushMicrotasks();
        verify(
          () => api.heartbeat(
            any(),
            positionSeconds: any(named: 'positionSeconds'),
          ),
        ).called(1);
        expect(controller.phase, PlaybackPhase.stopped);
        expect(player.stopped, isTrue);
        controller.dispose();
      });
    },
  );

  test(
    'REQUIRE_DRM refuses an unprotected authorization and ends the session',
    () {
      fakeAsync((async) {
        final controller = controllerFor(
          playerFactory: const ProtectedPlayerFactory(
            AppConfig(apiBaseUrl: 'http://api.test', requireDrm: true),
          ),
        );
        controller.start();
        async.flushMicrotasks();

        expect(controller.phase, PlaybackPhase.stopped);
        expect(controller.errorMessage, contains('DRM'));
        expect(controller.canRetry, isFalse);
        verify(() => api.endPlayback('session-1')).called(1);
        controller.dispose();
      });
    },
  );

  test('a DRM authorization goes to the native player stub, which is not implemented yet', () {
    fakeAsync((async) {
      when(
        () => api.startPlayback(
          contentId: 'content-1',
          deviceId: 'device-1',
          supportedDrm: const [DrmSystem.widevine],
        ),
      ).thenAnswer(
        (_) async => playbackAuthorization(
          drm: {
            'system': 'widevine',
            'licenseUrl': 'https://drm.example.com/license',
            'certificateUrl': null,
            'token': 'license-token',
          },
        ),
      );
      final controller = controllerFor(
        playerFactory: const ProtectedPlayerFactory(testConfig),
      );
      controller.start();
      async.flushMicrotasks();

      expect(controller.phase, PlaybackPhase.stopped);
      expect(controller.errorMessage, NativeDrmPlayer.notImplementedMessage);
      verify(() => api.endPlayback('session-1')).called(1);
      controller.dispose();
    });
  });
}
