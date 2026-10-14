import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'core/session/session_controller.dart';
import 'features/subscription/purchase_controller.dart';
import 'router.dart';

class StreamingApp extends ConsumerWidget {
  const StreamingApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final signedIn = ref.watch(
      sessionControllerProvider.select((s) => s.isSignedIn),
    );
    if (signedIn) {
      // Listen for store transactions (including ones re-delivered on launch)
      // as soon as there is a session to verify them against.
      ref.watch(purchaseControllerProvider);
    }
    return MaterialApp.router(
      title: 'StreamingApp',
      debugShowCheckedModeBanner: false,
      theme: buildDarkTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: ThemeMode.dark,
      routerConfig: router,
    );
  }
}

/// Dark theme suited to watching video: near-black surfaces, warm accent.
ThemeData buildDarkTheme() {
  const background = Color(0xFF0E0E12);
  final scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFFFF7A1A),
    brightness: Brightness.dark,
  ).copyWith(surface: background);

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: background,
    appBarTheme: const AppBarThemeData(
      backgroundColor: background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: scheme.surfaceContainerHigh,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    inputDecorationTheme: InputDecorationThemeData(
      filled: true,
      fillColor: scheme.surfaceContainerHighest,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
