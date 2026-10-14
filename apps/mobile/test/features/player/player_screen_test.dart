import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/api/api_providers.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/session/session_controller.dart';
import 'package:streamingapp/core/storage/secure_store.dart';
import 'package:streamingapp/features/player/player_screen.dart';
import 'package:streamingapp/features/player/protected_player.dart';

import '../../support/fakes.dart';
import '../../support/player_fakes.dart';

/// A signed-in session with a registered device, without network calls.
class SignedInSession extends SessionController {
  @override
  SessionState build() => SessionState(
    status: AuthStatus.signedIn,
    user: testUser(),
    device: testDevice(),
    deviceStatus: DeviceStatus.registered,
  );
}

void main() {
  late MockStreamingApi api;
  late FakePlayer player;

  setUp(() {
    api = MockStreamingApi();
    player = FakePlayer();
    when(
      () => api.startPlayback(
        contentId: 'content-1',
        deviceId: 'device-1',
        supportedDrm: const [DrmSystem.widevine],
      ),
    ).thenAnswer(
      (_) async => playbackAuthorization(heartbeatIntervalSeconds: 20),
    );
    when(() => api.endPlayback(any())).thenAnswer((_) async {});
  });

  Future<void> pumpPlayer(WidgetTester tester) async {
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) =>
              const PlayerScreen(contentId: 'content-1', title: 'Lesson 1'),
        ),
        GoRoute(
          path: '/paywall',
          builder: (context, state) => const Scaffold(body: Text('Paywall')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          keyValueStoreProvider.overrideWithValue(InMemoryKeyValueStore()),
          streamingApiProvider.overrideWithValue(api),
          playerFactoryProvider.overrideWithValue(FakePlayerFactory(player)),
          sessionControllerProvider.overrideWith(SignedInSession.new),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pump(); // authorize
    await tester.pump(); // initialize + play
  }

  testWidgets('a 403 heartbeat stops playback and explains why', (
    tester,
  ) async {
    when(
      () =>
          api.heartbeat(any(), positionSeconds: any(named: 'positionSeconds')),
    ).thenAnswer(
      (_) => Future.error(
        const ApiException(
          code: ApiErrorCode.concurrentStreamLimit,
          statusCode: 403,
          message: '',
        ),
      ),
    );

    await pumpPlayer(tester);
    expect(find.byKey(const Key('fakePlayer.view')), findsOneWidget);
    expect(player.playing, isTrue);

    await tester.pump(const Duration(seconds: 20)); // first heartbeat
    await tester.pump();

    expect(player.stopped, isTrue);
    expect(player.playing, isFalse);
    expect(find.byKey(const Key('fakePlayer.view')), findsNothing);
    expect(find.textContaining('Too many screens'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    // Leaving the screen does not try to end the already-revoked session.
    await tester.pumpWidget(const SizedBox());
    verifyNever(() => api.endPlayback(any()));
  });

  testWidgets(
    'ENTITLEMENT_REQUIRED on a heartbeat replaces the player with the paywall',
    (tester) async {
      when(
        () => api.heartbeat(
          any(),
          positionSeconds: any(named: 'positionSeconds'),
        ),
      ).thenAnswer(
        (_) => Future.error(
          const ApiException(
            code: ApiErrorCode.entitlementRequired,
            statusCode: 403,
            message: '',
          ),
        ),
      );

      await pumpPlayer(tester);
      await tester.pump(const Duration(seconds: 20));
      await tester.pumpAndSettle();

      expect(player.stopped, isTrue);
      expect(find.text('Paywall'), findsOneWidget);
      expect(player.disposed, isTrue);
    },
  );

  testWidgets('closing the player ends the playback session', (tester) async {
    when(
      () =>
          api.heartbeat(any(), positionSeconds: any(named: 'positionSeconds')),
    ).thenAnswer((_) async => DateTime.utc(2100));

    await pumpPlayer(tester);
    await tester.pump(const Duration(seconds: 20));
    verify(
      () => api.heartbeat(
        'session-1',
        positionSeconds: any(named: 'positionSeconds'),
      ),
    ).called(1);

    await tester.pumpWidget(const SizedBox());
    verify(() => api.endPlayback('session-1')).called(1);
    expect(player.disposed, isTrue);
  });
}
