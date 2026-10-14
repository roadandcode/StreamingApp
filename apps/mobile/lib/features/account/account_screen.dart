import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api/error_messages.dart';
import '../../core/api/models.dart';
import '../../core/device/device_list.dart';
import '../../core/device/device_providers.dart';
import '../../core/session/session_controller.dart';
import '../../core/ui/status_views.dart';
import '../subscription/subscription_providers.dart';
import 'account_providers.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(profileProvider)
            ..invalidate(subscriptionProvider)
            ..invalidate(devicesProvider);
          try {
            await ref.read(profileProvider.future);
          } on Object {
            // Shown inline by the profile section.
          }
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: const [
            _ProfileSection(),
            Divider(),
            _SubscriptionSection(),
            Divider(),
            _SectionTitle('Devices'),
            DeviceList(shrinkWrap: true),
            Divider(),
            _AccountActions(),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
    child: Text(title, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _ProfileSection extends ConsumerWidget {
  const _ProfileSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider);
    return switch (profile) {
      AsyncData(:final value) => ListTile(
        leading: CircleAvatar(
          child: Text(
            (value.displayName?.isNotEmpty ?? false
                    ? value.displayName!
                    : value.email)
                .substring(0, 1)
                .toUpperCase(),
          ),
        ),
        title: Text(
          value.displayName?.isNotEmpty ?? false
              ? value.displayName!
              : value.email,
        ),
        subtitle: Text(
          '${value.email}\nMember since ${formatDate(value.createdAt)}',
        ),
        isThreeLine: true,
      ),
      AsyncError(:final error) => ListTile(
        leading: const Icon(Icons.error_outline),
        title: Text(describeError(error)),
        trailing: IconButton(
          tooltip: 'Retry',
          icon: const Icon(Icons.refresh),
          onPressed: () => ref.invalidate(profileProvider),
        ),
      ),
      _ => const ListTile(title: Text('Loading profile…')),
    };
  }
}

class _SubscriptionSection extends ConsumerWidget {
  const _SubscriptionSection();

  static String _statusLabel(SubscriptionStatus status) => switch (status) {
    SubscriptionStatus.none => 'No subscription',
    SubscriptionStatus.pending => 'Pending',
    SubscriptionStatus.active => 'Active',
    SubscriptionStatus.gracePeriod => 'Active (payment issue: grace period)',
    SubscriptionStatus.billingRetry => 'Payment issue: retrying billing',
    SubscriptionStatus.cancelled => 'Cancelled',
    SubscriptionStatus.expired => 'Expired',
    SubscriptionStatus.refunded => 'Refunded',
    SubscriptionStatus.revoked => 'Revoked',
    SubscriptionStatus.unknown => 'Unknown',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subscription = ref.watch(subscriptionProvider);
    return switch (subscription) {
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ListTile(
            leading: Icon(
              value.hasAccess ? Icons.workspace_premium : Icons.lock_outline,
            ),
            title: Text(
              value.hasAccess ? 'Premium' : 'Free',
              key: const Key('account.subscription'),
            ),
            subtitle: Text(
              [
                _statusLabel(value.status),
                if (value.accessUntil != null)
                  '${value.autoRenewEnabled ? 'Renews' : 'Access until'} '
                      '${formatDate(value.accessUntil!)}',
              ].join(' · '),
            ),
          ),
          if (!value.hasAccess)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: FilledButton(
                onPressed: () => context.push('/paywall'),
                child: const Text('See plans'),
              ),
            ),
        ],
      ),
      AsyncError(:final error) => ListTile(
        leading: const Icon(Icons.error_outline),
        title: Text(describeError(error)),
        trailing: IconButton(
          tooltip: 'Retry',
          icon: const Icon(Icons.refresh),
          onPressed: () => ref.invalidate(subscriptionProvider),
        ),
      ),
      _ => const ListTile(title: Text('Loading subscription…')),
    };
  }
}

class _AccountActions extends ConsumerStatefulWidget {
  const _AccountActions();

  @override
  ConsumerState<_AccountActions> createState() => _AccountActionsState();
}

class _AccountActionsState extends ConsumerState<_AccountActions> {
  bool _busy = false;

  Future<void> _signOut() async {
    setState(() => _busy = true);
    await ref.read(sessionControllerProvider.notifier).signOut();
  }

  Future<void> _deleteAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => const _DeleteAccountDialog(),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(sessionControllerProvider.notifier).deleteAccount();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(describeError(error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        ListTile(
          key: const Key('account.signOut'),
          enabled: !_busy,
          leading: const Icon(Icons.logout),
          title: const Text('Sign out'),
          onTap: _signOut,
        ),
        ListTile(
          key: const Key('account.delete'),
          enabled: !_busy,
          leading: Icon(Icons.delete_forever, color: scheme.error),
          title: Text('Delete account', style: TextStyle(color: scheme.error)),
          subtitle: const Text(
            'Store subscriptions must be cancelled separately in your store '
            'account.',
          ),
          onTap: _deleteAccount,
        ),
      ],
    );
  }
}

/// Requires typing DELETE before the destructive action is enabled.
class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog();

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final _confirmation = TextEditingController();

  @override
  void dispose() {
    _confirmation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final confirmed = _confirmation.text.trim() == 'DELETE';
    return AlertDialog(
      title: const Text('Delete your account?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'This signs you out everywhere, removes your devices and stops all '
            'playback. Type DELETE to confirm.',
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('account.deleteConfirm'),
            controller: _confirmation,
            autocorrect: false,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(hintText: 'DELETE'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: scheme.error,
            foregroundColor: scheme.onError,
          ),
          onPressed: confirmed ? () => Navigator.of(context).pop(true) : null,
          child: const Text('Delete account'),
        ),
      ],
    );
  }
}
