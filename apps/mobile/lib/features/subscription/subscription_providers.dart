import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/api_providers.dart';
import '../../core/api/models.dart';
import '../../core/session/session_controller.dart';

/// The signed-in user's subscription. `hasAccess` drives lock icons only; the
/// server authorizes every playback.
final subscriptionProvider = FutureProvider<SubscriptionView>((ref) {
  if (ref.watch(currentUserIdProvider) == null) {
    throw const ApiException(
      code: ApiErrorCode.unauthenticated,
      statusCode: null,
      message: 'Not signed in.',
    );
  }
  return ref.watch(streamingApiProvider).subscription();
});

final plansProvider = FutureProvider<List<Plan>>(
  (ref) => ref.watch(streamingApiProvider).plans(),
);
