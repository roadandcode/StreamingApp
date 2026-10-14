import 'package:material_ui/material_ui.dart';
import 'package:streamingapp/core/api/models.dart';
import 'package:streamingapp/core/config.dart';
import 'package:streamingapp/features/player/protected_player.dart';

import 'fakes.dart';

/// Records what the playback controller asks of the player.
class FakePlayer extends ChangeNotifier implements ProtectedPlayer {
  FakePlayer({this.initializeError});

  final PlayerException? initializeError;
  PlaybackAuthorization? initializedWith;
  bool playing = false;
  bool stopped = false;
  bool disposed = false;
  int pauseCalls = 0;
  Duration currentPosition = Duration.zero;

  @override
  Future<void> initialize(PlaybackAuthorization authorization) async {
    final error = initializeError;
    if (error != null) throw error;
    initializedWith = authorization;
  }

  @override
  Future<void> play() async {
    if (stopped) return;
    playing = true;
    notifyListeners();
  }

  @override
  Future<void> pause() async {
    pauseCalls++;
    playing = false;
    notifyListeners();
  }

  @override
  Future<void> seekTo(Duration position) async => currentPosition = position;

  @override
  Future<void> stop() async {
    playing = false;
    stopped = true;
  }

  @override
  Future<void> dispose() async {
    if (disposed) return;
    disposed = true;
    super.dispose();
  }

  @override
  bool get isInitialized => initializedWith != null;
  @override
  bool get isPlaying => playing;
  @override
  bool get isBuffering => false;
  @override
  bool get isCompleted => false;
  @override
  Duration get position => currentPosition;
  @override
  Duration get duration => const Duration(minutes: 10);
  @override
  double get aspectRatio => 16 / 9;
  @override
  String? get errorDescription => null;
  @override
  Widget buildView(BuildContext context) =>
      const ColoredBox(key: Key('fakePlayer.view'), color: Colors.black);
}

class FakePlayerFactory implements ProtectedPlayerFactory {
  FakePlayerFactory(this.player);

  final FakePlayer player;
  int created = 0;

  @override
  AppConfig get config => testConfig;

  @override
  TargetPlatform? get platform => TargetPlatform.android;

  @override
  List<DrmSystem> get supportedDrm => const [DrmSystem.widevine];

  @override
  ProtectedPlayer create(PlaybackAuthorization authorization) {
    created++;
    return player;
  }
}
