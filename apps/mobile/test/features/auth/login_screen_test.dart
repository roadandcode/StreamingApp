import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/api/api_providers.dart';
import 'package:streamingapp/core/storage/secure_store.dart';
import 'package:streamingapp/features/auth/login_screen.dart';
import 'package:streamingapp/features/auth/validators.dart';

import '../../support/fakes.dart';

void main() {
  late MockStreamingApi api;

  setUp(() => api = MockStreamingApi());

  Future<void> pumpLogin(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          keyValueStoreProvider.overrideWithValue(InMemoryKeyValueStore()),
          streamingApiProvider.overrideWithValue(api),
        ],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> submit(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();
  }

  testWidgets('empty form shows required-field errors and sends nothing', (
    tester,
  ) async {
    await pumpLogin(tester);
    await submit(tester);

    expect(find.text('Enter your email address'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
    verifyNever(
      () => api.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    );
  });

  testWidgets('rejects a malformed email and a password under 10 characters', (
    tester,
  ) async {
    await pumpLogin(tester);
    await tester.enterText(
      find.byKey(const Key('login.email')),
      'not-an-email',
    );
    await tester.enterText(find.byKey(const Key('login.password')), 'short123');
    await submit(tester);

    expect(find.text('Enter a valid email address'), findsOneWidget);
    expect(
      find.text('Password must be at least 10 characters'),
      findsOneWidget,
    );
    verifyNever(
      () => api.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    );
  });

  testWidgets('shows the message for the API error code', (tester) async {
    when(
      () => api.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    ).thenAnswer(
      (_) => Future.error(
        const ApiException(
          code: ApiErrorCode.invalidCredentials,
          statusCode: 401,
          message: 'server wording that may change',
        ),
      ),
    );

    await pumpLogin(tester);
    await tester.enterText(
      find.byKey(const Key('login.email')),
      ' viewer@example.com ',
    );
    await tester.enterText(
      find.byKey(const Key('login.password')),
      'correct-horse',
    );
    await submit(tester);

    expect(find.text('Enter a valid email address'), findsNothing);
    expect(find.text('Incorrect email or password.'), findsOneWidget);
    expect(find.text('server wording that may change'), findsNothing);
    verify(
      () => api.login(email: 'viewer@example.com', password: 'correct-horse'),
    ).called(1);
  });

  group('AuthValidators', () {
    test('email', () {
      expect(AuthValidators.email('a@b.co'), isNull);
      expect(AuthValidators.email(' a@b.co '), isNull);
      expect(AuthValidators.email('a@b'), isNotNull);
      expect(AuthValidators.email('a b@c.de'), isNotNull);
      expect(AuthValidators.email(''), isNotNull);
    });

    test('password needs at least 10 characters', () {
      expect(AuthValidators.password('123456789'), isNotNull);
      expect(AuthValidators.password('1234567890'), isNull);
    });
  });
}
