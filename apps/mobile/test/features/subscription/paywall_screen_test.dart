import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/api/api_providers.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/config.dart';
import 'package:streamingapp/core/storage/secure_store.dart';
import 'package:streamingapp/features/subscription/paywall_screen.dart';
import 'package:streamingapp/features/subscription/store_billing.dart';

import '../../support/fakes.dart';
import '../../support/store_fakes.dart';

void main() {
  late MockStreamingApi api;
  late FakeStoreBilling billing;
  late List<String> log;

  setUpAll(registerFallbacks);

  setUp(() {
    api = MockStreamingApi();
    log = [];
    billing = FakeStoreBilling(
      products: [storeProduct(price: '€4,99')],
      log: log,
    );
    when(() => api.plans()).thenAnswer((_) async => [premiumPlan()]);
    when(() => api.subscription()).thenAnswer((_) async => subscriptionView());
    when(
      () => api.verifyPurchase(
        provider: any(named: 'provider'),
        productId: any(named: 'productId'),
        receipt: any(named: 'receipt'),
      ),
    ).thenAnswer((_) async {
      log.add('verify');
      return subscriptionView(hasAccess: true);
    });
  });

  tearDown(() => billing.dispose());

  Future<void> pumpPaywall(
    WidgetTester tester, {
    required bool fakeBilling,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          appConfigProvider.overrideWithValue(
            AppConfig(apiBaseUrl: 'http://api.test', fakeBilling: fakeBilling),
          ),
          keyValueStoreProvider.overrideWithValue(InMemoryKeyValueStore()),
          streamingApiProvider.overrideWithValue(api),
          storeBillingProvider.overrideWithValue(billing),
        ],
        child: const MaterialApp(home: PaywallScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('lists plans with the store’s localized price', (tester) async {
    await pumpPaywall(tester, fakeBilling: false);

    expect(find.text('Premium Monthly'), findsOneWidget);
    expect(find.text('€4,99 · Monthly'), findsOneWidget);
    expect(find.textContaining('₹'), findsNothing);
    expect(find.text('Restore purchases'), findsOneWidget);
    expect(find.text('Simulate purchase (dev)'), findsNothing);
  });

  testWidgets('plans not sold on Google Play are not shown', (tester) async {
    when(() => api.plans()).thenAnswer(
      (_) async => [
        premiumPlan(),
        Plan.fromJson({
          'code': 'other_channel_yearly',
          'name': 'Other Channel Yearly',
          'billingPeriod': 'P1Y',
          'accessTier': 'premium',
          'storeProducts': [
            {'provider': 'razorpay', 'productId': 'other_yearly'},
          ],
        }),
      ],
    );
    await pumpPaywall(tester, fakeBilling: false);

    expect(find.text('Premium Monthly'), findsOneWidget);
    expect(find.text('Other Channel Yearly'), findsNothing);
  });

  testWidgets(
    'FAKE_BILLING shows the simulate button, which verifies a fake receipt',
    (tester) async {
      await pumpPaywall(tester, fakeBilling: true);

      final simulate = find.text('Simulate purchase (dev)');
      expect(simulate, findsOneWidget);
      await tester.ensureVisible(simulate);
      await tester.tap(simulate);
      await tester.pumpAndSettle();

      final captured = verify(
        () => api.verifyPurchase(
          provider: captureAny(named: 'provider'),
          productId: captureAny(named: 'productId'),
          receipt: captureAny(named: 'receipt'),
        ),
      ).captured;
      expect(captured[0], BillingProvider.fake);
      expect(captured[1], 'fake_premium_monthly');
      expect(
        captured[2],
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          ),
        ),
      );
      expect(find.byKey(const Key('paywall.success')), findsOneWidget);
      expect(
        log,
        isNot(contains(startsWith('complete'))),
        reason: 'no store transaction',
      );
    },
  );

  testWidgets(
    'a store purchase is verified by the server before it is completed',
    (tester) async {
      await pumpPaywall(tester, fakeBilling: false);

      await tester.tap(find.byKey(const Key('paywall.buy.premium_monthly')));
      await tester.pump();
      expect(log, ['buy:premium_monthly_play']);

      billing.updates.add([storePurchase(token: 'play-token-123')]);
      await tester.pumpAndSettle();

      verify(
        () => api.verifyPurchase(
          provider: BillingProvider.google,
          productId: 'premium_monthly_play',
          receipt: 'play-token-123',
        ),
      ).called(1);
      expect(log, [
        'buy:premium_monthly_play',
        'verify',
        'complete:premium_monthly_play',
      ]);
      expect(find.byKey(const Key('paywall.success')), findsOneWidget);
    },
  );

  testWidgets('a purchase the server rejects is not completed', (tester) async {
    when(
      () => api.verifyPurchase(
        provider: any(named: 'provider'),
        productId: any(named: 'productId'),
        receipt: any(named: 'receipt'),
      ),
    ).thenAnswer(
      (_) => Future.error(
        const ApiException(
          code: ApiErrorCode.purchaseBelongsToOtherAccount,
          statusCode: 409,
          message: '',
        ),
      ),
    );
    await pumpPaywall(tester, fakeBilling: false);

    billing.updates.add([storePurchase()]);
    await tester.pumpAndSettle();

    expect(log.where((e) => e.startsWith('complete')), isEmpty);
    expect(find.byKey(const Key('paywall.error')), findsOneWidget);
    expect(
      find.textContaining('already linked to a different account'),
      findsOneWidget,
    );
  });

  testWidgets('restore asks the store to re-deliver purchases', (tester) async {
    await pumpPaywall(tester, fakeBilling: false);

    await tester.tap(find.byKey(const Key('paywall.restore')));
    await tester.pumpAndSettle();
    expect(log, ['restore']);

    billing.updates.add([storePurchase(status: PurchaseStatus.restored)]);
    await tester.pumpAndSettle();
    expect(log, ['restore', 'verify', 'complete:premium_monthly_play']);
  });
}
