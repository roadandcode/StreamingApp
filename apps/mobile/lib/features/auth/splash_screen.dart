import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/session/session_controller.dart';

/// Shown while the stored session is being restored on launch.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionControllerProvider);
    final theme = Theme.of(context);
    final failed = session.status == AuthStatus.restoreFailed;
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.play_circle_fill,
                size: 72,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 24),
              if (failed) ...[
                Text(
                  session.error ?? 'Could not connect.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyLarge,
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  children: [
                    OutlinedButton(
                      onPressed: () => ref
                          .read(sessionControllerProvider.notifier)
                          .signOut(),
                      child: const Text('Sign out'),
                    ),
                    FilledButton(
                      onPressed: () => ref
                          .read(sessionControllerProvider.notifier)
                          .restore(),
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              ] else
                const CircularProgressIndicator(),
            ],
          ),
        ),
      ),
    );
  }
}
