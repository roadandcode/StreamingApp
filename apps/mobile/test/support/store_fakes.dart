import 'dart:async';

import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/features/subscription/store_billing.dart';

class FakeStoreBilling implements StoreBilling {
  FakeStoreBilling({
    this.provider = BillingProvider.google,
    this.available = true,
    List<ProductDetails>? products,
    List<String>? log,
  }) : products = products ?? [],
       log = log ?? [];

  @override
  final BillingProvider provider;
  final bool available;
  final List<ProductDetails> products;
  final List<String> log;
  final StreamController<List<PurchaseDetails>> updates =
      StreamController<List<PurchaseDetails>>.broadcast();

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => updates.stream;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<List<ProductDetails>> queryProducts(Set<String> productIds) async =>
      products.where((p) => productIds.contains(p.id)).toList();

  @override
  Future<void> buySubscription(ProductDetails product) async =>
      log.add('buy:${product.id}');

  @override
  Future<void> completePurchase(PurchaseDetails purchase) async =>
      log.add('complete:${purchase.productID}');

  @override
  Future<void> restorePurchases() async => log.add('restore');

  Future<void> dispose() => updates.close();
}

ProductDetails storeProduct({
  String id = 'premium_monthly_play',
  String price = r'$4.99',
}) => ProductDetails(
  id: id,
  title: 'Premium Monthly',
  description: 'All premium content',
  price: price,
  rawPrice: 4.99,
  currencyCode: 'USD',
);

PurchaseDetails storePurchase({
  String productId = 'premium_monthly_play',
  String token = 'purchase-token-1',
  PurchaseStatus status = PurchaseStatus.purchased,
}) => PurchaseDetails(
  purchaseID: 'order-1',
  productID: productId,
  verificationData: PurchaseVerificationData(
    localVerificationData: '{}',
    serverVerificationData: token,
    source: 'google_play',
  ),
  transactionDate: '1700000000000',
  status: status,
)..pendingCompletePurchase = true;
