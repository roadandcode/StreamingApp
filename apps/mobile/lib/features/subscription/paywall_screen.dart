import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/config.dart';
import '../../core/ui/status_views.dart';
import 'purchase_controller.dart';
import 'subscription_providers.dart';

class PaywallScreen extends ConsumerStatefulWidget {
  const PaywallScreen({super.key});

  @override
  ConsumerState<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends ConsumerState<PaywallScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(purchaseControllerProvider.notifier).clearFinished();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final paywall = ref.watch(paywallProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Go Premium')),
      body: switch (paywall) {
        AsyncData(:final value) => _PaywallBody(data: value),
        AsyncError(:final error) => ErrorView(
          error: error,
          onRetry: () {
            ref.invalidate(plansProvider);
            ref.invalidate(paywallProvider);
          },
        ),
        _ => const LoadingView(),
      },
    );
  }
}

class _PaywallBody extends ConsumerWidget {
  const _PaywallBody({required this.data});

  final PaywallData data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final purchase = ref.watch(purchaseControllerProvider);
    final controller = ref.read(purchaseControllerProvider.notifier);
    final fakeBilling = ref.watch(appConfigProvider).fakeBilling;
    final hasAccess =
        purchase.subscription?.hasAccess ??
        ref.watch(subscriptionProvider).value?.hasAccess ??
        false;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Unlock every course and original video',
          style: theme.textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text(
          'Subscriptions renew automatically. Cancel anytime from your store '
          'account settings.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 16),
        if (hasAccess) ...[
          const MessageBanner(
            message: 'You have an active subscription. Enjoy watching!',
            isError: false,
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () => context.canPop() ? context.pop() : context.go('/'),
            child: const Text('Start watching'),
          ),
          const SizedBox(height: 16),
        ],
        _PurchaseStatus(state: purchase),
        if (!data.storeAvailable) ...[
          const MessageBanner(
            message:
                'The store is not available on this device, so plans cannot '
                'be bought here right now.',
            isError: false,
          ),
          const SizedBox(height: 16),
        ],
        if (data.offers.isEmpty)
          const EmptyView(message: 'No plans are available right now.'),
        for (final offer in data.offers)
          _PlanCard(
            offer: offer,
            enabled: !purchase.isBusy && data.storeAvailable,
            onBuy: offer.product == null
                ? null
                : () => controller.buy(offer.product!),
          ),
        const SizedBox(height: 8),
        TextButton.icon(
          key: const Key('paywall.restore'),
          onPressed: purchase.isBusy || !data.storeAvailable
              ? null
              : controller.restore,
          icon: const Icon(Icons.restore),
          label: const Text('Restore purchases'),
        ),
        if (fakeBilling) ...[
          const Divider(height: 32),
          OutlinedButton.icon(
            key: const Key('paywall.simulate'),
            onPressed: purchase.isBusy
                ? null
                : () => controller.simulateFakePurchase(
                    productId: data.fakeProductId,
                  ),
            icon: const Icon(Icons.science_outlined),
            label: const Text('Simulate purchase (dev)'),
          ),
          const SizedBox(height: 4),
          Text(
            'Development build: verifies a fake receipt with the API.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall,
          ),
        ],
      ],
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.offer,
    required this.enabled,
    required this.onBuy,
  });

  final PaywallOffer offer;
  final bool enabled;
  final VoidCallback? onBuy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final product = offer.product;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(offer.plan.name, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    product == null
                        ? 'Not available in the store yet'
                        // Localized price string from the store; never
                        // hardcoded.
                        : '${product.price} · ${offer.plan.billingPeriodLabel}',
                    style: theme.textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(
              key: Key('paywall.buy.${offer.plan.code}'),
              onPressed: enabled ? onBuy : null,
              child: const Text('Subscribe'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PurchaseStatus extends StatelessWidget {
  const _PurchaseStatus({required this.state});

  final PurchaseState state;

  @override
  Widget build(BuildContext context) {
    final Widget? content = switch (state.status) {
      PurchaseFlowStatus.purchasing => const _Progress('Opening the store…'),
      PurchaseFlowStatus.verifying => const _Progress(
        'Confirming your purchase…',
      ),
      PurchaseFlowStatus.pending => MessageBanner(
        message: state.message ?? 'Payment pending.',
        isError: false,
      ),
      PurchaseFlowStatus.success => const MessageBanner(
        key: Key('paywall.success'),
        message: 'Purchase confirmed. Premium is unlocked.',
        isError: false,
      ),
      PurchaseFlowStatus.error => MessageBanner(
        key: const Key('paywall.error'),
        message: state.message ?? 'Something went wrong.',
      ),
      PurchaseFlowStatus.idle =>
        state.message == null
            ? null
            : MessageBanner(message: state.message!, isError: false),
    };
    if (content == null) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(bottom: 16), child: content);
  }
}

class _Progress extends StatelessWidget {
  const _Progress(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      const SizedBox.square(
        dimension: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
      const SizedBox(width: 12),
      Expanded(child: Text(label)),
    ],
  );
}
