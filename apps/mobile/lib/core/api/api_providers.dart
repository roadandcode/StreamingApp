import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';
import '../session/session_controller.dart';
import '../storage/secure_store.dart';
import 'api_client.dart';
import 'streaming_api.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUrl: ref.watch(appConfigProvider).apiBaseUrl,
    tokenStore: ref.watch(secureStoreProvider),
    // Refresh failed: the tokens are already cleared; route to login.
    onSessionExpired: () =>
        ref.read(sessionControllerProvider.notifier).onSessionExpired(),
  );
  ref.onDispose(client.close);
  return client;
});

final streamingApiProvider = Provider<StreamingApi>(
  (ref) => StreamingApi(ref.watch(apiClientProvider)),
);
