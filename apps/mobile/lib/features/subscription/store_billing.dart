import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../../core/api/models.dart';

/// The platform store (Google Play Billing or the App Store), behind an
/// interface so the paywall can be tested without a store.
abstract interface class StoreBilling {
  /// `google` on Android, `apple` on iOS.
  BillingProvider get provider;

  /// Purchase updates, including transactions re-delivered on app launch
  /// because they were never completed.
  Stream<List<PurchaseDetails>> get purchaseStream;

  Future<bool> isAvailable();

  /// Store products with localized prices. Unknown ids are left out.
  Future<List<ProductDetails>> queryProducts(Set<String> productIds);

  /// Starts the store's purchase sheet. The result arrives on
  /// [purchaseStream].
  Future<void> buySubscription(ProductDetails product);

  /// Finishes (iOS) / acknowledges (Android) a transaction. Only call after
  /// the server accepted the purchase, or for a failed/cancelled one.
  Future<void> completePurchase(PurchaseDetails purchase);

  /// Re-delivers owned subscriptions on [purchaseStream] as `restored`.
  Future<void> restorePurchases();
}

class InAppPurchaseBilling implements StoreBilling {
  InAppPurchaseBilling({required this.provider});

  @override
  final BillingProvider provider;

  InAppPurchase get _store => InAppPurchase.instance;

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => _store.purchaseStream;

  @override
  Future<bool> isAvailable() => _store.isAvailable();

  @override
  Future<List<ProductDetails>> queryProducts(Set<String> productIds) async {
    if (productIds.isEmpty) return const [];
    final response = await _store.queryProductDetails(productIds);
    // Google Play returns one entry per subscription offer; keep the first
    // (base plan) entry for each product id.
    final byId = <String, ProductDetails>{};
    for (final product in response.productDetails) {
      byId.putIfAbsent(product.id, () => product);
    }
    return byId.values.toList(growable: false);
  }

  @override
  Future<void> buySubscription(ProductDetails product) async {
    // Subscriptions are bought as non-consumables in in_app_purchase.
    await _store.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: product),
    );
  }

  @override
  Future<void> completePurchase(PurchaseDetails purchase) =>
      _store.completePurchase(purchase);

  @override
  Future<void> restorePurchases() => _store.restorePurchases();
}

/// Android (Google Play Billing, `provider: "google"`, receipt = the
/// `purchaseToken`) is the launch platform. The Apple path (`provider:
/// "apple"`, receipt = the StoreKit 2 transaction JWS) is kept for the later
/// iOS release and has not been exercised against App Store Connect yet.
final storeBillingProvider = Provider<StoreBilling>(
  (ref) => InAppPurchaseBilling(
    provider: defaultTargetPlatform == TargetPlatform.iOS
        ? BillingProvider.apple
        : BillingProvider.google,
  ),
);
