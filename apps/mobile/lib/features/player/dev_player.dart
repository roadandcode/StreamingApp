import 'package:material_ui/material_ui.dart';
import 'package:video_player/video_player.dart';

import '../../core/api/models.dart';
import 'protected_player.dart';

/// Plays unprotected HLS (`drm == null`) with `video_player`.
///
/// Only for development against the API's fake media provider. Production
/// streams carry Widevine/FairPlay DRM and go through [ProtectedPlayer]
/// implementations backed by native code.
class DevPlayer extends ChangeNotifier implements ProtectedPlayer {
  VideoPlayerController? _controller;
  bool _stopped = false;
  bool _disposed = false;

  @override
  Future<void> initialize(PlaybackAuthorization authorization) async {
    if (authorization.drm != null) {
      throw const UnsupportedPlaybackException(
        'DevPlayer cannot play DRM-protected streams.',
      );
    }
    final controller = VideoPlayerController.networkUrl(
      Uri.parse(authorization.manifestUrl),
      formatHint: VideoFormat.hls,
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: false),
    );
    _controller = controller;
    controller.addListener(_onControllerChanged);
    try {
      await controller.initialize();
    } on Object {
      // Deliberately no details: the platform error can contain the URL.
      throw const PlayerException('The video could not be opened.');
    }
  }

  void _onControllerChanged() {
    if (!_disposed) notifyListeners();
  }

  VideoPlayerValue? get _value => _controller?.value;

  @override
  Future<void> play() async {
    if (_stopped) return;
    await _controller?.play();
  }

  @override
  Future<void> pause() async => _controller?.pause();

  @override
  Future<void> seekTo(Duration position) async {
    if (_stopped) return;
    await _controller?.seekTo(position);
  }

  @override
  Future<void> stop() async {
    if (_stopped) return;
    _stopped = true;
    final controller = _controller;
    _controller = null;
    if (controller != null) {
      controller.removeListener(_onControllerChanged);
      await controller.pause();
      await controller.dispose();
    }
    if (!_disposed) notifyListeners();
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    await stop();
    _disposed = true;
    super.dispose();
  }

  @override
  bool get isInitialized => _value?.isInitialized ?? false;

  @override
  bool get isPlaying => _value?.isPlaying ?? false;

  @override
  bool get isBuffering => _value?.isBuffering ?? false;

  @override
  bool get isCompleted => _value?.isCompleted ?? false;

  @override
  Duration get position => _value?.position ?? Duration.zero;

  @override
  Duration get duration => _value?.duration ?? Duration.zero;

  @override
  double get aspectRatio {
    final ratio = _value?.aspectRatio ?? 0;
    return ratio > 0 ? ratio : 16 / 9;
  }

  @override
  String? get errorDescription =>
      (_value?.hasError ?? false) ? 'Playback failed.' : null;

  @override
  Widget buildView(BuildContext context) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return const ColoredBox(color: Colors.black);
    }
    return VideoPlayer(controller);
  }
}
