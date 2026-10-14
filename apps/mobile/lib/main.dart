import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    ProviderScope(
      // No automatic retries: API failures (401/403 especially) are surfaced
      // to the user, who can pull to refresh or tap "Try again".
      retry: (retryCount, error) => null,
      child: const StreamingApp(),
    ),
  );
}
