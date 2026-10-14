import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:uuid/uuid.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/api_providers.dart';
import '../../core/api/error_messages.dart';
import '../../core/api/models.dart';
import 'store_billing.dart';
import 'subscription_providers.dart';

enum PurchaseFlowStatus { idle, purchasing, pending, verifying, success, error }

@immutable
class PurchaseState {
  const PurchaseState(this.status, {this.message, this.subscription});

  const PurchaseState.idle({this.message})
    : status = PurchaseFlowStatus.idle,
      subscription = null;

  final PurchaseFlowStatus status;
  final String? message;

  /// The server's view after a successful verification.
  final SubscriptionView? subscription;

  bool get isBusy =>
      status == PurchaseFlowStatus.purchasing ||
      status == PurchaseFlowStatus.verifying;
}

/// Product id the API's fake billing provider sells in development.
const fakeBillingProductId = 'fake_premium_monthly';

/// Handles store purchases: every `purchased`/`restored` transaction is sent
/// to `POST /v1/purchases/verify`, and the transaction is completed only
/// after the server accepts it. The app never grants access itself.
class PurchaseController extends Notifier<PurchaseState> {
  StreamSubscription<List<PurchaseDetails>>? _updates;

  /// Store updates are handled one batch at a time, in order.
  Future<void> _queue = Future.value();

  @override
  PurchaseState build() {
    final billing = ref.watch(storeBillingProvider);
    _updates = billing.purchaseStream.listen(
      (purchases) => _queue = _queue.then((_) => _onPurchaseUpdates(purchases)),
      onError: (Object error) {
        state = const PurchaseState(
          PurchaseFlowStatus.error,
          message: 'The store reported a problem. Please try again.',
        );
      },
    );
    ref.onDispose(() => _updates?.cancel());
    return const PurchaseState.idle();
  }

  StoreBilling get _billing => ref.read(storeBillingProvider);

  /// Drops a finished flow's message (e.g. when the paywall opens again).
  void clearFinished() {
    if (state.isBusy || state.status == PurchaseFlowStatus.pending) return;
    state = const PurchaseState.idle();
  }

  Future<void> buy(ProductDetails product) async {
    if (state.isBusy) return;
    state = const PurchaseState(PurchaseFlowStatus.purchasing);
    try {
      await _billing.buySubscription(product);
    } on Object {
      state = const PurchaseState(
        PurchaseFlowStatus.error,
        message: 'The store could not start the purchase. Please try again.',
      );
    }
  }

  Future<void> restore() async {
    if (state.isBusy) return;
    try {
      await _billing.restorePurchases();
      state = const PurchaseState.idle(
        message:
            'Checking the store for your purchases. An active subscription '
            'will be restored in a moment.',
      );
    } on Object {
      state = const PurchaseState(
        PurchaseFlowStatus.error,
        message: 'Could not reach the store to restore purchases.',
      );
    }
  }

  /// Development only (`FAKE_BILLING=true`): asks the API's fake billing
  /// provider to activate a subscription with a random receipt.
  Future<void> simulateFakePurchase({
    String productId = fakeBillingProductId,
  }) async {
    if (state.isBusy) return;
    state = const PurchaseState(PurchaseFlowStatus.verifying);
    try {
      final view = await ref
          .read(streamingApiProvider)
          .verifyPurchase(
            provider: BillingProvider.fake,
            productId: productId,
            receipt: const Uuid().v4(),
          );
      ref.invalidate(subscriptionProvider);
      state = PurchaseState(PurchaseFlowStatus.success, subscription: view);
    } on ApiException catch (error) {
      state = PurchaseState(
        PurchaseFlowStatus.error,
        message: describeError(error),
      );
    }
  }

  Future<void> _onPurchaseUpdates(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      try {
        await _handle(purchase);
      } on Object {
        // Keep processing the queue; the transaction stays unfinished and
        // the store delivers it again.
        state = const PurchaseState(
          PurchaseFlowStatus.error,
          message: 'Something went wrong confirming your purchase.',
        );
      }
    }
  }

  Future<void> _handle(PurchaseDetails purchase) async {
    switch (purchase.status) {
      case PurchaseStatus.pending:
        state = const PurchaseState(
          PurchaseFlowStatus.pending,
          message: 'Waiting for the store to confirm your payment.',
        );
      case PurchaseStatus.canceled:
        // Nothing was bought; finishing it only clears the store's queue.
        await _completeQuietly(purchase);
        state = const PurchaseState.idle(message: 'Purchase cancelled.');
      case PurchaseStatus.error:
        await _completeQuietly(purchase);
        state = const PurchaseState(
          PurchaseFlowStatus.error,
          message:
              'The purchase did not go through. You have not been charged.',
        );
      case PurchaseStatus.purchased:
      case PurchaseStatus.restored:
        await _verify(purchase);
    }
  }

  Future<void> _verify(PurchaseDetails purchase) async {
    // Google: purchaseToken. Apple (StoreKit 2): the transaction JWS.
    final receipt = purchase.verificationData.serverVerificationData;
    if (receipt.isEmpty) {
      state = const PurchaseState(
        PurchaseFlowStatus.error,
        message: 'The store did not provide proof of purchase.',
      );
      return;
    }
    state = const PurchaseState(PurchaseFlowStatus.verifying);
    final SubscriptionView view;
    try {
      view = await ref
          .read(streamingApiProvider)
          .verifyPurchase(
            provider: _billing.provider,
            productId: purchase.productID,
            receipt: receipt,
          );
    } on ApiException catch (error) {
      // Not completed: the store re-delivers it on the next launch (and
      // Google refunds purchases that are never acknowledged).
      state = PurchaseState(
        PurchaseFlowStatus.error,
        message: describeError(error),
      );
      return;
    }
    // The server accepted the proof: only now finish the transaction.
    await _completeQuietly(purchase);
    ref.invalidate(subscriptionProvider);
    state = PurchaseState(PurchaseFlowStatus.success, subscription: view);
  }

  Future<void> _completeQuietly(PurchaseDetails purchase) async {
    if (!purchase.pendingCompletePurchase) return;
    try {
      await _billing.completePurchase(purchase);
    } on Object {
      // Retried automatically: the store re-delivers unfinished transactions.
    }
  }
}

final purchaseControllerProvider =
    NotifierProvider<PurchaseController, PurchaseState>(PurchaseController.new);

/// One plan on the paywall with its store product (and localized price).
@immutable
class PaywallOffer {
  const PaywallOffer({required this.plan, this.productId, this.product});

  final Plan plan;

  /// The plan's product id in this platform's store.
  final String? productId;

  /// Store details, or null when the store did not return the product.
  final ProductDetails? product;
}

@immutable
class PaywallData {
  const PaywallData({
    required this.offers,
    required this.storeAvailable,
    required this.fakeProductId,
  });

  final List<PaywallOffer> offers;
  final bool storeAvailable;

  /// The plans' fake-billing product id (development only).
  final String fakeProductId;
}

final paywallProvider = FutureProvider.autoDispose<PaywallData>((ref) async {
  final plans = await ref.watch(plansProvider.future);
  final billing = ref.watch(storeBillingProvider);

  final productIds = <String>{
    for (final plan in plans) ?plan.productIdFor(billing.provider),
  };
  var available = false;
  var products = const <ProductDetails>[];
  try {
    available = await billing.isAvailable();
    if (available) products = await billing.queryProducts(productIds);
  } on Object {
    available = false;
  }
  final byId = {for (final product in products) product.id: product};

  return PaywallData(
    storeAvailable: available,
    fakeProductId:
        plans
            .map((plan) => plan.productIdFor(BillingProvider.fake))
            .firstWhere((id) => id != null, orElse: () => null) ??
        fakeBillingProductId,
    // Only plans sold in this platform's store are shown. Google Play policy:
    // the Android app must not mention or link to any other way to buy.
    offers: [
      for (final plan in plans)
        if (plan.productIdFor(billing.provider) case final productId?)
          PaywallOffer(
            plan: plan,
            productId: productId,
            product: byId[productId],
          ),
    ],
  );
});
