import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/device/device_limit_screen.dart';
import 'core/session/session_controller.dart';
import 'features/account/account_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/auth/splash_screen.dart';
import 'features/catalog/home_screen.dart';
import 'features/content/content_detail_screen.dart';
import 'features/player/player_screen.dart';
import 'features/subscription/paywall_screen.dart';

abstract final class Routes {
  static const splash = '/splash';
  static const login = '/login';
  static const register = '/register';
  static const home = '/';
  static const deviceLimit = '/device-limit';
  static const account = '/account';
  static const paywall = '/paywall';
}

/// Decides where the session state allows the user to be.
///
/// * restoring a session: splash only
/// * signed out: login and registration only
/// * signed in but over the device limit: the device-limit screen only
/// * signed in: everything else
String? sessionRedirect(SessionState session, String location) {
  final atAuth = location == Routes.login || location == Routes.register;
  switch (session.status) {
    case AuthStatus.restoring:
    case AuthStatus.restoreFailed:
      return location == Routes.splash ? null : Routes.splash;
    case AuthStatus.signedOut:
      return atAuth ? null : Routes.login;
    case AuthStatus.signedIn:
      if (session.deviceStatus == DeviceStatus.limitReached) {
        return location == Routes.deviceLimit ? null : Routes.deviceLimit;
      }
      if (atAuth ||
          location == Routes.splash ||
          location == Routes.deviceLimit) {
        return Routes.home;
      }
      return null;
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  // Re-run redirects whenever the session changes.
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionControllerProvider, (_, _) => refresh.value++);

  final router = GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: refresh,
    redirect: (context, state) => sessionRedirect(
      ref.read(sessionControllerProvider),
      state.matchedLocation,
    ),
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: Routes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: Routes.register,
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: Routes.deviceLimit,
        builder: (context, state) => const DeviceLimitScreen(),
      ),
      GoRoute(
        path: Routes.home,
        builder: (context, state) => const HomeScreen(),
        routes: [
          GoRoute(
            path: 'content/:id',
            builder: (context, state) =>
                ContentDetailScreen(contentId: state.pathParameters['id']!),
          ),
          GoRoute(
            path: 'play/:id',
            builder: (context, state) => PlayerScreen(
              contentId: state.pathParameters['id']!,
              title: state.uri.queryParameters['title'],
            ),
          ),
          GoRoute(
            path: 'paywall',
            builder: (context, state) => const PaywallScreen(),
          ),
          GoRoute(
            path: 'account',
            builder: (context, state) => const AccountScreen(),
          ),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});
