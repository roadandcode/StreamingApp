import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api/models.dart';
import 'protected_player.dart';

/// DRM playback through native players over a platform channel.
///
/// Not implemented yet. Android is the launch platform, so Widevine comes
/// first; FairPlay follows with the later iOS release.
///
/// TODO(android): implement the channel in MainActivity.kt with Media3
/// ExoPlayer and Widevine:
/// * add `androidx.media3:media3-exoplayer`, `-exoplayer-hls` and `-ui`;
/// * build the `MediaItem` from `manifestUrl` with
///   `MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID)`,
///   `setLicenseUri(drm.licenseUrl)` and the license token in
///   `setLicenseRequestHeaders` (header name to be agreed with the API team);
/// * check `MediaDrm.isCryptoSchemeSupported(C.WIDEVINE_UUID)` and the
///   `securityLevel` property (L1 vs L3) and report failures as errors;
/// * render into a secure `SurfaceView` (`setSecure(true)`) exposed as a
///   platform view, keep `FLAG_SECURE` on the activity, and release the
///   player on `dispose` and on `stop` (any 403 from the playback API).
///
/// TODO(ios, after the Android launch): implement the channel in
/// AppDelegate.swift with AVPlayer and FairPlay: fetch the application
/// certificate from `drm.certificateUrl`, use an `AVContentKeySession`
/// delegate to create the SPC, post it with the license token to
/// `drm.licenseUrl`, and hand the CKC back to AVFoundation. Render with an
/// `AVPlayerLayer` platform view.
///
/// Channel methods (planned): `create` {manifestUrl, drm: {system,
/// licenseUrl, certificateUrl, token}} -> {textureOrViewId}, `play`, `pause`,
/// `seekTo` {positionMs}, `position` -> positionMs, `dispose`. Native code must
/// never log the manifest URL or license token.
class NativeDrmPlayer extends ChangeNotifier implements ProtectedPlayer {
  NativeDrmPlayer({MethodChannel? channel})
    : channel = channel ?? defaultChannel;

  static const defaultChannel = MethodChannel(
    'com.roadandcode.streamingapp/drm_player',
  );

  final MethodChannel channel;

  static const notImplementedMessage =
      'DRM playback (Widevine on Android, FairPlay on iOS) is not implemented '
      'yet in this app build.';

  @override
  Future<void> initialize(PlaybackAuthorization authorization) async {
    // TODO(drm): call `channel.invokeMethod('create', ...)` once the native
    // Media3 / AVPlayer implementations exist.
    throw const UnsupportedPlaybackException(notImplementedMessage);
  }

  @override
  Future<void> play() async =>
      throw const UnsupportedPlaybackException(notImplementedMessage);

  @override
  Future<void> pause() async {}

  @override
  Future<void> seekTo(Duration position) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async => super.dispose();

  @override
  bool get isInitialized => false;

  @override
  bool get isPlaying => false;

  @override
  bool get isBuffering => false;

  @override
  bool get isCompleted => false;

  @override
  Duration get position => Duration.zero;

  @override
  Duration get duration => Duration.zero;

  @override
  double get aspectRatio => 16 / 9;

  @override
  String? get errorDescription => notImplementedMessage;

  @override
  Widget buildView(BuildContext context) =>
      const ColoredBox(color: Colors.black);
}
