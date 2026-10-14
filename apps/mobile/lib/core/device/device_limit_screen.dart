import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../session/session_controller.dart';
import '../ui/status_views.dart';
import 'device_list.dart';

/// Shown after `409 DEVICE_LIMIT_REACHED`: remove a device, then registration
/// is retried.
class DeviceLimitScreen extends ConsumerWidget {
  const DeviceLimitScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final controller = ref.read(sessionControllerProvider.notifier);
    final retrying = session.deviceStatus == DeviceStatus.registering;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Too many devices'),
        automaticallyImplyLeading: false,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Your account is already used on the maximum number of '
              'devices. Remove one to watch on this device.',
              style: theme.textTheme.bodyLarge,
            ),
          ),
          if (session.error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: MessageBanner(message: session.error!),
            ),
          Expanded(
            child: DeviceList(
              // Removing a device frees a slot: retry registration right away.
              onRemoved: controller.registerDevice,
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: retrying ? null : () => controller.signOut(),
                      child: const Text('Sign out'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      key: const Key('deviceLimit.retry'),
                      onPressed: retrying ? null : controller.registerDevice,
                      child: retrying
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Try again'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
