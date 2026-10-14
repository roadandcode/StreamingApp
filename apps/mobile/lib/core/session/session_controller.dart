import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../api/api_providers.dart';
import '../api/error_messages.dart';
import '../api/models.dart';
import '../device/device_registrar.dart';
import '../storage/secure_store.dart';

enum AuthStatus {
  /// Reading stored tokens and validating them with `GET /v1/me`.
  restoring,

  /// Stored tokens exist but the server could not be reached.
  restoreFailed,
  signedOut,
  signedIn,
}

enum DeviceStatus { unknown, registering, registered, limitReached, failed }

abstract final class SessionNotices {
  static const sessionExpired =
      'Your session has expired. Please sign in again.';
  static const deviceRevoked =
      'This device was removed from your account, so you have been signed '
      'out. Contact support if you did not expect this.';
  static const accountInactive =
      'This account is suspended or deleted. Contact support for help.';
  static const accountDeleted = 'Your account has been deleted.';
}

@immutable
class SessionState {
  const SessionState({
    required this.status,
    this.user,
    this.device,
    this.deviceStatus = DeviceStatus.unknown,
    this.notice,
    this.error,
  });

  final AuthStatus status;
  final User? user;

  /// This installation's registered device, once `POST /v1/me/devices` worked.
  final Device? device;
  final DeviceStatus deviceStatus;

  /// Explanation shown on the login screen after a forced sign-out.
  final String? notice;

  /// Last restore or device-registration failure, for display.
  final String? error;

  bool get isSignedIn => status == AuthStatus.signedIn;

  SessionState copyWith({
    Device? device,
    bool clearDevice = false,
    DeviceStatus? deviceStatus,
    String? error,
    bool clearError = false,
  }) => SessionState(
    status: status,
    user: user,
    device: clearDevice ? null : (device ?? this.device),
    deviceStatus: deviceStatus ?? this.deviceStatus,
    notice: notice,
    error: clearError ? null : (error ?? this.error),
  );
}

/// Owns the signed-in state: login, registration, restore on launch, device
/// registration, sign-out and session expiry.
class SessionController extends Notifier<SessionState> {
  Future<void>? _deviceRegistration;

  @override
  SessionState build() {
    scheduleMicrotask(restore);
    return const SessionState(status: AuthStatus.restoring);
  }

  SecureStore get _store => ref.read(secureStoreProvider);

  /// Restores a stored session on launch (or after "Retry" on the splash).
  Future<void> restore() async {
    state = const SessionState(status: AuthStatus.restoring);
    Tokens? tokens;
    try {
      tokens = await _store.readTokens();
    } on Object {
      tokens = null; // unreadable storage: start signed out
    }
    if (tokens == null) {
      state = const SessionState(status: AuthStatus.signedOut);
      return;
    }

    final User user;
    try {
      user = await ref.read(streamingApiProvider).me();
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await _store.clearTokens();
        if (state.status != AuthStatus.signedOut) {
          state = SessionState(
            status: AuthStatus.signedOut,
            notice: error.code == ApiErrorCode.accountInactive
                ? SessionNotices.accountInactive
                : SessionNotices.sessionExpired,
          );
        }
      } else {
        state = SessionState(
          status: AuthStatus.restoreFailed,
          error: describeError(error),
        );
      }
      return;
    }
    if (state.status == AuthStatus.signedOut) return; // expired meanwhile
    state = SessionState(status: AuthStatus.signedIn, user: user);
    await registerDevice();
  }

  /// Throws [ApiException] (e.g. `INVALID_CREDENTIALS`) for the form to show.
  Future<void> signIn({required String email, required String password}) async {
    final result = await ref
        .read(streamingApiProvider)
        .login(email: email, password: password);
    await _completeSignIn(result);
  }

  /// Throws [ApiException] (e.g. `EMAIL_TAKEN`) for the form to show.
  Future<void> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    final result = await ref
        .read(streamingApiProvider)
        .register(email: email, password: password, displayName: displayName);
    await _completeSignIn(result);
  }

  Future<void> _completeSignIn(AuthResult result) async {
    await _store.writeTokens(result.tokens);
    state = SessionState(status: AuthStatus.signedIn, user: result.user);
    await registerDevice();
  }

  /// Registers this installation; concurrent callers share one request.
  Future<void> registerDevice() {
    if (!state.isSignedIn) return Future.value();
    return _deviceRegistration ??= _registerDevice().whenComplete(
      () => _deviceRegistration = null,
    );
  }

  Future<void> _registerDevice() async {
    state = state.copyWith(
      deviceStatus: DeviceStatus.registering,
      clearError: true,
    );
    final DeviceRegistrationResult result;
    try {
      result = await ref.read(deviceRegistrarProvider).register();
    } on ApiException catch (error) {
      if (state.isSignedIn) {
        state = state.copyWith(
          deviceStatus: DeviceStatus.failed,
          error: describeError(error),
        );
      }
      return;
    }
    if (!state.isSignedIn) return;
    switch (result) {
      case DeviceRegistered(:final device):
        state = state.copyWith(
          device: device,
          deviceStatus: DeviceStatus.registered,
        );
      case DeviceLimitReached():
        state = state.copyWith(
          clearDevice: true,
          deviceStatus: DeviceStatus.limitReached,
        );
      case DeviceRevoked():
        await signOut(notice: SessionNotices.deviceRevoked);
    }
  }

  /// The registered device id required by `POST /v1/playback/sessions`.
  Future<String> ensureDeviceId() async {
    final existing = state.device;
    if (state.isSignedIn && existing != null) return existing.id;
    await registerDevice();
    final device = state.device;
    if (state.isSignedIn && device != null) return device.id;
    throw ApiException(
      code: state.deviceStatus == DeviceStatus.limitReached
          ? ApiErrorCode.deviceLimitReached
          : ApiErrorCode.deviceNotRegistered,
      statusCode: null,
      message: state.error ?? 'This device is not registered.',
    );
  }

  /// Signs out locally right away and revokes the server session.
  Future<void> signOut({String? notice}) async {
    Tokens? tokens;
    try {
      tokens = await _store.readTokens();
    } on Object {
      tokens = null;
    }
    await _store.clearTokens();
    state = SessionState(status: AuthStatus.signedOut, notice: notice);
    if (tokens != null) {
      try {
        await ref.read(streamingApiProvider).logout(tokens.refreshToken);
      } on ApiException {
        // Best effort: the local session is gone either way.
      }
    }
  }

  /// The device was revoked (by the user elsewhere, or support).
  Future<void> onDeviceRevoked() =>
      signOut(notice: SessionNotices.deviceRevoked);

  /// Called by the API client when the refresh token was rejected.
  void onSessionExpired() {
    if (state.status == AuthStatus.signedOut) return;
    state = const SessionState(
      status: AuthStatus.signedOut,
      notice: SessionNotices.sessionExpired,
    );
  }

  /// `DELETE /v1/me`, then sign out locally. Throws [ApiException].
  Future<void> deleteAccount() async {
    await ref.read(streamingApiProvider).deleteAccount();
    await _store.clearTokens();
    state = const SessionState(
      status: AuthStatus.signedOut,
      notice: SessionNotices.accountDeleted,
    );
  }
}

final sessionControllerProvider =
    NotifierProvider<SessionController, SessionState>(SessionController.new);

/// The signed-in user's id; user-scoped data providers watch this so they
/// reload after a different user signs in.
final currentUserIdProvider = Provider<String?>(
  (ref) => ref.watch(sessionControllerProvider.select((s) => s.user?.id)),
);
