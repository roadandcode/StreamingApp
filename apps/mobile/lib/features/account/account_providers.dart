import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_providers.dart';
import '../../core/api/models.dart';
import '../../core/session/session_controller.dart';

/// The signed-in user's profile (`GET /v1/me`).
final profileProvider = FutureProvider.autoDispose<User>((ref) {
  ref.watch(currentUserIdProvider);
  return ref.watch(streamingApiProvider).me();
});
