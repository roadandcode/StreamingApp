import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/error_messages.dart';
import '../../core/api/models.dart';
import '../../core/api/streaming_api.dart';
import 'protected_player.dart';

enum PlaybackPhase {
  /// Asking the server for a playback authorization.
  authorizing,

  /// Authorized; opening the stream.
  preparing,

  /// Stream open; playing or paused by the user.
  ready,

  /// Stopped by the server (any 403), an expired session, or a failure.
  stopped,
}

/// Runs one playback session: authorize, play, heartbeat, end.
///
/// The server is the only authority. The controller never plays without a
/// fresh authorization, stops the player on any 403 from the playback API,
/// and stops once the authorization expires without a successful heartbeat.
class PlaybackController extends ChangeNotifier {
  PlaybackController({
    required this.contentId,
    required this._api,
    required this._playerFactory,
    required this._resolveDeviceId,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final String contentId;
  final StreamingApi _api;
  final ProtectedPlayerFactory _playerFactory;
  final Future<String> Function() _resolveDeviceId;
  final DateTime Function() _clock;

  /// Lower bound for the heartbeat interval, in case of a misconfigured API.
  static const minHeartbeatInterval = Duration(seconds: 5);

  PlaybackPhase _phase = PlaybackPhase.authorizing;
  ProtectedPlayer? _player;
  PlaybackAuthorization? _authorization;
  DateTime? _expiresAt;
  Timer? _heartbeatTimer;
  bool _sessionOpen = false;
  bool _heartbeatInFlight = false;
  bool _backgrounded = false;
  bool _disposed = false;
  Duration _lastPosition = Duration.zero;
  String? _errorCode;
  String? _errorMessage;

  PlaybackPhase get phase => _phase;
  ProtectedPlayer? get player => _player;
  bool get isBackgrounded => _backgrounded;

  /// Error `code` that stopped playback (API code or a client-side code).
  String? get errorCode => _errorCode;
  String? get errorMessage => _errorMessage;

  /// The server says the viewer needs a subscription: show the paywall.
  bool get requiresSubscription =>
      _errorCode == ApiErrorCode.entitlementRequired;

  /// This device was revoked: the app must sign out.
  bool get deviceRevoked => _errorCode == ApiErrorCode.deviceRevoked;

  bool get canRetry =>
      _phase == PlaybackPhase.stopped &&
      !requiresSubscription &&
      !deviceRevoked &&
      _errorCode != ApiErrorCode.notFound &&
      _errorCode != ApiErrorCode.regionNotAllowed &&
      _errorCode != ApiErrorCode.contentNotPlayable &&
      _errorCode != ApiErrorCode.accountInactive &&
      _errorCode != _unsupportedCode;

  static const _unsupportedCode = 'PLAYER_UNSUPPORTED';
  static const _playerErrorCode = 'PLAYER_ERROR';
  static const _authorizationExpiredCode = 'AUTHORIZATION_EXPIRED';

  /// Requests an authorization and starts playing it.
  Future<void> start({Duration startAt = Duration.zero}) async {
    _errorCode = null;
    _errorMessage = null;
    _setPhase(PlaybackPhase.authorizing);

    final PlaybackAuthorization authorization;
    try {
      final deviceId = await _resolveDeviceId();
      if (_disposed) return;
      authorization = await _api.startPlayback(
        contentId: contentId,
        deviceId: deviceId,
        supportedDrm: _playerFactory.supportedDrm,
      );
    } on Object catch (error) {
      _halt(
        error is ApiException ? error.code : ApiErrorCode.unknown,
        describeError(error),
      );
      return;
    }
    if (_disposed) {
      _endSessionQuietly(authorization.playbackSessionId);
      return;
    }

    _authorization = authorization;
    _expiresAt = authorization.expiresAt;
    _sessionOpen = true;
    _setPhase(PlaybackPhase.preparing);

    final ProtectedPlayer player;
    try {
      player = _playerFactory.create(authorization);
    } on PlayerException catch (error) {
      _closeSession();
      _halt(_unsupportedCode, error.message);
      return;
    }
    _player = player;
    player.addListener(_onPlayerChanged);
    if (!_backgrounded) _startHeartbeats();

    try {
      await player.initialize(authorization);
    } on PlayerException catch (error) {
      if (_phase == PlaybackPhase.stopped || _disposed) return;
      _closeSession();
      _halt(
        error is UnsupportedPlaybackException
            ? _unsupportedCode
            : _playerErrorCode,
        error.message,
      );
      return;
    }
    // A heartbeat may have stopped playback while the stream was opening.
    if (_disposed || _phase == PlaybackPhase.stopped) return;
    if (startAt > Duration.zero) await player.seekTo(startAt);
    _setPhase(PlaybackPhase.ready);
    if (!_backgrounded) await player.play();
  }

  /// Starts a fresh session from the last known position.
  Future<void> retry() async {
    if (_phase != PlaybackPhase.stopped) return;
    await _releasePlayer();
    await start(startAt: _lastPosition);
  }

  /// Sends one heartbeat. Called on a timer; public for tests.
  Future<void> sendHeartbeat() async {
    final authorization = _authorization;
    if (authorization == null || !_sessionOpen || _heartbeatInFlight) return;
    _heartbeatInFlight = true;
    try {
      final position = _player?.position;
      if (position != null && position > Duration.zero) {
        _lastPosition = position;
      }
      _expiresAt = await _api.heartbeat(
        authorization.playbackSessionId,
        positionSeconds: _lastPosition.inSeconds,
      );
    } on ApiException catch (error) {
      if (_disposed) return;
      if (error.isForbidden) {
        // ENTITLEMENT_REQUIRED, DEVICE_REVOKED, PLAYBACK_SESSION_ENDED, ...:
        // the server has revoked this session. Stop now.
        _sessionOpen = false;
        _halt(error.code, describeError(error));
      } else if (error.statusCode == 401) {
        // The login session is over; the app is routing to sign-in.
        _halt(error.code, describeError(error));
      } else if (_authorizationExpired) {
        // Transient failures are tolerated only until the authorization runs
        // out; never keep playing past it.
        _closeSession();
        _halt(
          _authorizationExpiredCode,
          'Lost connection to the server, so playback was stopped.',
        );
      }
    } finally {
      _heartbeatInFlight = false;
    }
  }

  /// The app went to the background: pause and stop heartbeats.
  void onAppBackgrounded() {
    if (_backgrounded || _disposed) return;
    _backgrounded = true;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    final player = _player;
    if (player != null) {
      if (player.position > Duration.zero) _lastPosition = player.position;
      unawaited(player.pause());
    }
    notifyListeners();
  }

  /// Back in the foreground: re-validate with a heartbeat right away and
  /// resume the schedule. Playback stays paused until the viewer resumes it.
  Future<void> onAppResumed() async {
    if (!_backgrounded || _disposed) return;
    _backgrounded = false;
    notifyListeners();
    if (!_sessionOpen || _phase == PlaybackPhase.stopped) return;
    if (_authorizationExpired) {
      _closeSession();
      _halt(
        _authorizationExpiredCode,
        'Playback was paused for too long. Tap "Try again" to continue.',
      );
      return;
    }
    _startHeartbeats();
    await sendHeartbeat();
  }

  bool get _authorizationExpired {
    final expiresAt = _expiresAt;
    return expiresAt != null && !_clock().toUtc().isBefore(expiresAt);
  }

  void _startHeartbeats() {
    final authorization = _authorization;
    if (authorization == null) return;
    _heartbeatTimer?.cancel();
    final interval = Duration(
      seconds: math.max(
        authorization.heartbeatIntervalSeconds,
        minHeartbeatInterval.inSeconds,
      ),
    );
    _heartbeatTimer = Timer.periodic(interval, (_) => sendHeartbeat());
  }

  void _onPlayerChanged() {
    final player = _player;
    if (player == null || _disposed) return;
    if (player.position > Duration.zero) _lastPosition = player.position;
    if (player.errorDescription != null && _phase == PlaybackPhase.ready) {
      _closeSession();
      _halt(_playerErrorCode, 'Playback failed. Tap "Try again" to reconnect.');
    }
    // Position and play/pause changes are rendered by listening to the player
    // itself; the controller only notifies about phase changes.
  }

  /// Stops the player immediately and records why.
  void _halt(String code, String message) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    final player = _player;
    if (player != null) unawaited(player.stop());
    _errorCode = code;
    _errorMessage = message;
    _setPhase(PlaybackPhase.stopped);
  }

  /// Ends the server session (best effort) if it is still open.
  void _closeSession() {
    final authorization = _authorization;
    if (!_sessionOpen || authorization == null) return;
    _sessionOpen = false;
    _endSessionQuietly(authorization.playbackSessionId);
  }

  void _endSessionQuietly(String playbackSessionId) {
    unawaited(
      _api
          .endPlayback(playbackSessionId)
          .then<void>((_) {}, onError: (Object _) {}),
    );
  }

  Future<void> _releasePlayer() async {
    final player = _player;
    _player = null;
    if (player != null) {
      player.removeListener(_onPlayerChanged);
      await player.dispose();
    }
  }

  void _setPhase(PlaybackPhase phase) {
    if (_disposed) return;
    _phase = phase;
    notifyListeners();
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _closeSession();
    unawaited(_releasePlayer());
    super.dispose();
  }
}
