import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api/api_providers.dart';
import '../../core/session/session_controller.dart';
import '../../core/ui/status_views.dart';
import 'playback_controller.dart';
import 'protected_player.dart';

class PlayerScreen extends ConsumerStatefulWidget {
  const PlayerScreen({super.key, required this.contentId, this.title});

  final String contentId;
  final String? title;

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen>
    with WidgetsBindingObserver {
  late final PlaybackController _controller;
  bool _leftForPaywall = false;

  @override
  void initState() {
    super.initState();
    _controller = PlaybackController(
      contentId: widget.contentId,
      api: ref.read(streamingApiProvider),
      playerFactory: ref.read(playerFactoryProvider),
      resolveDeviceId: () =>
          ref.read(sessionControllerProvider.notifier).ensureDeviceId(),
    )..addListener(_onControllerChanged);
    WidgetsBinding.instance.addObserver(this);
    unawaited(_controller.start());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        _controller.onAppBackgrounded();
      case AppLifecycleState.resumed:
        unawaited(_controller.onAppResumed());
      case AppLifecycleState.inactive:
        break;
    }
  }

  void _onControllerChanged() {
    if (!mounted) return;
    if (_controller.requiresSubscription && !_leftForPaywall) {
      _leftForPaywall = true;
      context.pushReplacement('/paywall');
      return;
    }
    setState(() {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller
      ..removeListener(_onControllerChanged)
      ..dispose(); // ends the server session
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final player = _controller.player;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title ?? ''),
      ),
      body: SafeArea(
        child: Center(
          child: switch (_controller.phase) {
            PlaybackPhase.authorizing ||
            PlaybackPhase.preparing => const LoadingView(),
            PlaybackPhase.ready when player != null => _VideoWithControls(
              player: player,
            ),
            PlaybackPhase.ready => const LoadingView(),
            PlaybackPhase.stopped => _StoppedView(
              controller: _controller,
              onSignOut: () => ref
                  .read(sessionControllerProvider.notifier)
                  .onDeviceRevoked(),
              onClose: () => context.pop(),
            ),
          },
        ),
      ),
    );
  }
}

class _VideoWithControls extends StatelessWidget {
  const _VideoWithControls({required this.player});

  final ProtectedPlayer player;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: player,
      builder: (context, _) {
        final duration = player.duration;
        final position = player.position > duration
            ? duration
            : player.position;
        final maxMs = duration.inMilliseconds.toDouble();
        return Column(
          children: [
            // The video takes the space left by the controls, so the layout
            // fits in portrait and landscape.
            Expanded(
              child: Center(
                child: AspectRatio(
                  aspectRatio: player.aspectRatio,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      player.buildView(context),
                      if (player.isBuffering)
                        const Center(child: CircularProgressIndicator()),
                    ],
                  ),
                ),
              ),
            ),
            if (maxMs > 0)
              Slider(
                value: position.inMilliseconds.clamp(0, maxMs).toDouble(),
                max: maxMs,
                onChanged: (value) =>
                    player.seekTo(Duration(milliseconds: value.round())),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  formatPosition(position),
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(width: 16),
                IconButton(
                  tooltip: 'Back 10 seconds',
                  color: Colors.white,
                  icon: const Icon(Icons.replay_10),
                  onPressed: () =>
                      player.seekTo(position - const Duration(seconds: 10)),
                ),
                IconButton.filled(
                  key: const Key('player.playPause'),
                  tooltip: player.isPlaying ? 'Pause' : 'Play',
                  iconSize: 36,
                  icon: Icon(player.isPlaying ? Icons.pause : Icons.play_arrow),
                  onPressed: () =>
                      player.isPlaying ? player.pause() : player.play(),
                ),
                IconButton(
                  tooltip: 'Forward 10 seconds',
                  color: Colors.white,
                  icon: const Icon(Icons.forward_10),
                  onPressed: () =>
                      player.seekTo(position + const Duration(seconds: 10)),
                ),
                const SizedBox(width: 16),
                Text(
                  formatPosition(duration),
                  style: const TextStyle(color: Colors.white70),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _StoppedView extends StatelessWidget {
  const _StoppedView({
    required this.controller,
    required this.onSignOut,
    required this.onClose,
  });

  final PlaybackController controller;
  final VoidCallback onSignOut;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: const Key('player.stopped'),
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.block, size: 48, color: Colors.white70),
          const SizedBox(height: 16),
          Text(
            controller.errorMessage ?? 'Playback stopped.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 16),
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            alignment: WrapAlignment.center,
            children: [
              if (controller.deviceRevoked)
                FilledButton(
                  onPressed: onSignOut,
                  child: const Text('Sign out'),
                )
              else ...[
                if (controller.canRetry)
                  FilledButton.icon(
                    onPressed: controller.retry,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Try again'),
                  ),
                OutlinedButton(onPressed: onClose, child: const Text('Close')),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
