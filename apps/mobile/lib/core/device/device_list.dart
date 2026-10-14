import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_providers.dart';
import '../api/error_messages.dart';
import '../api/models.dart';
import '../ui/status_views.dart';
import 'device_providers.dart';

/// Active devices with a "Remove" action (`DELETE /v1/me/devices/:id`).
///
/// The current installation cannot be removed from here: a removed device is
/// revoked for good, so the user would lock this install out. Signing out is
/// the way to leave this device.
class DeviceList extends ConsumerStatefulWidget {
  const DeviceList({super.key, this.onRemoved, this.shrinkWrap = false});

  /// Called after a device was removed.
  final VoidCallback? onRemoved;
  final bool shrinkWrap;

  @override
  ConsumerState<DeviceList> createState() => _DeviceListState();
}

class _DeviceListState extends ConsumerState<DeviceList> {
  final Set<String> _removing = {};

  Future<void> _remove(Device device) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove device?'),
        content: Text(
          '"${device.name}" will be signed out of playback and must be '
          'registered again to watch.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _removing.add(device.id));
    try {
      await ref.read(streamingApiProvider).removeDevice(device.id);
      ref.invalidate(devicesProvider);
      widget.onRemoved?.call();
    } on Object catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(describeError(error))));
      }
    } finally {
      if (mounted) setState(() => _removing.remove(device.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final devices = ref.watch(devicesProvider);
    final installationId = ref.watch(installationIdProvider).value;
    return switch (devices) {
      AsyncData(:final value) when value.isEmpty => const Padding(
        padding: EdgeInsets.all(16),
        child: Text('No active devices.'),
      ),
      AsyncData(:final value) => ListView.builder(
        shrinkWrap: widget.shrinkWrap,
        physics: widget.shrinkWrap
            ? const NeverScrollableScrollPhysics()
            : null,
        itemCount: value.length,
        itemBuilder: (context, index) {
          final device = value[index];
          final isThisDevice = device.installationId == installationId;
          return ListTile(
            key: Key('device.${device.id}'),
            leading: Icon(switch (device.platform) {
              DevicePlatform.android => Icons.phone_android,
              DevicePlatform.ios => Icons.phone_iphone,
              _ => Icons.devices_other,
            }),
            title: Text(device.name),
            subtitle: Text(
              isThisDevice
                  ? 'This device'
                  : 'Last active ${formatDate(device.lastSeenAt)}',
            ),
            trailing: isThisDevice
                ? null
                : _removing.contains(device.id)
                ? const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : TextButton(
                    onPressed: () => _remove(device),
                    child: const Text('Remove'),
                  ),
          );
        },
      ),
      AsyncError(:final error) => ErrorView(
        error: error,
        onRetry: () => ref.invalidate(devicesProvider),
      ),
      _ => const Padding(padding: EdgeInsets.all(16), child: LoadingView()),
    };
  }
}
