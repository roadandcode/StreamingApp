import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api/models.dart';
import '../../core/config.dart';
import 'dev_player.dart';
import 'native_drm_player.dart';

/// A video player that plays one server-issued [PlaybackAuthorization].
///
/// Implementations must never log the manifest URL or DRM token.
abstract class ProtectedPlayer implements Listenable {
  /// Prepares playback of [authorization]. Throws [PlayerException] when the
  /// stream cannot be opened.
  Future<void> initialize(PlaybackAuthorization authorization);

  Future<void> play();

  Future<void> pause();

  Future<void> seekTo(Duration position);

  /// Stops playback immediately and releases the stream. Used when the server
  /// revokes the session (any 403); the player cannot be restarted after.
  Future<void> stop();

  Future<void> dispose();

  bool get isInitialized;
  bool get isPlaying;
  bool get isBuffering;
  bool get isCompleted;
  Duration get position;
  Duration get duration;
  double get aspectRatio;

  /// Non-null when the underlying player failed (e.g. the signed manifest URL
  /// expired).
  String? get errorDescription;

  /// The video surface.
  Widget buildView(BuildContext context);
}

class PlayerException implements Exception {
  const PlayerException(this.message);

  final String message;

  @override
  String toString() => 'PlayerException: $message';
}

/// Thrown when an authorization needs a player this build does not have.
class UnsupportedPlaybackException extends PlayerException {
  const UnsupportedPlaybackException(super.message);
}

/// Picks the player for an authorization.
class ProtectedPlayerFactory {
  const ProtectedPlayerFactory(this.config, {this.platform});

  final AppConfig config;

  /// Overrides the running platform (tests).
  final TargetPlatform? platform;

  /// DRM systems this platform's native player supports, sent as
  /// `supportedDrm` when a playback session is requested. Android (the launch
  /// platform) uses Widevine through Media3; iOS will use FairPlay.
  List<DrmSystem> get supportedDrm =>
      (platform ?? defaultTargetPlatform) == TargetPlatform.iOS
      ? const [DrmSystem.fairplay]
      : const [DrmSystem.widevine];

  ProtectedPlayer create(PlaybackAuthorization authorization) {
    if (authorization.drm != null) return NativeDrmPlayer();
    if (config.requireDrm) {
      throw const UnsupportedPlaybackException(
        'This build only plays DRM-protected streams, and the server sent an '
        'unprotected one.',
      );
    }
    return DevPlayer();
  }
}

final playerFactoryProvider = Provider<ProtectedPlayerFactory>(
  (ref) => ProtectedPlayerFactory(ref.watch(appConfigProvider)),
);
