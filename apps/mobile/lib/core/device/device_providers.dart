import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_providers.dart';
import '../api/models.dart';
import '../session/session_controller.dart';
import '../storage/secure_store.dart';

/// Active devices on the account (`GET /v1/me/devices`).
final devicesProvider = FutureProvider.autoDispose<List<Device>>((ref) {
  ref.watch(currentUserIdProvider);
  return ref.watch(streamingApiProvider).devices();
});

/// This installation's id, used to mark "This device" in lists.
final installationIdProvider = FutureProvider<String>(
  (ref) => ref.watch(secureStoreProvider).installationId(),
);
