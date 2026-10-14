import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Build-time configuration, supplied with `--dart-define`.
///
/// ```sh
/// flutter run \
///   --dart-define=API_BASE_URL=http://10.0.2.2:3000 \
///   --dart-define=FAKE_BILLING=true \
///   --dart-define=REQUIRE_DRM=false
/// ```
@immutable
class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    this.fakeBilling = false,
    this.requireDrm = false,
  });

  /// Reads the compile-time defines, falling back to the local development API
  /// for the current platform (Android emulator or iOS simulator).
  factory AppConfig.fromEnvironment({TargetPlatform? platform}) {
    const override = String.fromEnvironment('API_BASE_URL');
    final target = platform ?? defaultTargetPlatform;
    final baseUrl = override.isNotEmpty
        ? override
        : (target == TargetPlatform.iOS
              ? defaultIosBaseUrl
              : defaultAndroidBaseUrl);
    return AppConfig(
      apiBaseUrl: normalizeBaseUrl(baseUrl),
      fakeBilling: const bool.fromEnvironment('FAKE_BILLING'),
      requireDrm: const bool.fromEnvironment('REQUIRE_DRM'),
    );
  }

  /// The Android emulator reaches the host machine through 10.0.2.2.
  static const defaultAndroidBaseUrl = 'http://10.0.2.2:3000';

  /// The iOS simulator shares the host's network stack.
  static const defaultIosBaseUrl = 'http://localhost:3000';

  /// API origin without a trailing slash, e.g. `https://api.example.com`.
  /// Endpoint paths (which all start with `/v1`) are appended to it.
  final String apiBaseUrl;

  /// Shows the "Simulate purchase (dev)" button that verifies a purchase with
  /// the API's fake billing provider. Never enable for store builds.
  final bool fakeBilling;

  /// When true the app refuses to play any authorization without DRM, i.e.
  /// unprotected development streams from the fake media provider.
  final bool requireDrm;

  static String normalizeBaseUrl(String url) {
    var result = url.trim();
    while (result.endsWith('/')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }
}

final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);
