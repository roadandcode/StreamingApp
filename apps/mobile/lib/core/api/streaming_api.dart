import 'api_client.dart';
import 'api_exception.dart';
import 'json.dart';
import 'models.dart';

/// Typed access to the v1 endpoints the mobile app uses.
///
/// Every method throws [ApiException] on failure.
class StreamingApi {
  StreamingApi(this._client);

  final ApiClient _client;

  // Auth and account ---------------------------------------------------------

  Future<AuthResult> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    final body = await _client.post(
      '/v1/auth/register',
      authenticated: false,
      body: {
        'email': email,
        'password': password,
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
      },
    );
    return _parse(body, AuthResult.fromJson);
  }

  Future<AuthResult> login({
    required String email,
    required String password,
  }) async {
    final body = await _client.post(
      '/v1/auth/login',
      authenticated: false,
      body: {'email': email, 'password': password},
    );
    return _parse(body, AuthResult.fromJson);
  }

  /// Revokes the login session that owns [refreshToken].
  Future<void> logout(String refreshToken) async {
    await _client.post(
      '/v1/auth/logout',
      authenticated: false,
      body: {'refreshToken': refreshToken},
    );
  }

  Future<User> me() async => _parse(await _client.get('/v1/me'), User.fromJson);

  /// Soft-deletes the account and revokes its sessions, devices and playback.
  Future<void> deleteAccount() async {
    await _client.delete('/v1/me');
  }

  // Catalog (public) ---------------------------------------------------------

  Future<Paginated<ContentSummary>> catalog({
    ContentKind? kind,
    String? language,
    int page = 1,
    int pageSize = 50,
  }) async {
    final body = await _client.get(
      '/v1/catalog',
      authenticated: false,
      query: {
        'kind': kind?.name,
        'language': language,
        'page': page,
        'pageSize': pageSize,
      },
    );
    return _parse(
      body,
      (json) => Paginated.fromJson(json, ContentSummary.fromJson),
    );
  }

  Future<ContentDetail> content(String id) async {
    final body = await _client.get(
      '/v1/content/${Uri.encodeComponent(id)}',
      authenticated: false,
    );
    return _parse(body, ContentDetail.fromJson);
  }

  // Plans and subscriptions --------------------------------------------------

  Future<List<Plan>> plans() async {
    final body = await _client.get('/v1/plans', authenticated: false);
    return _parseList(body, Plan.fromJson);
  }

  Future<SubscriptionView> subscription() async => _parse(
    await _client.get('/v1/me/subscription'),
    SubscriptionView.fromJson,
  );

  /// Sends store proof to the server, which verifies it with the provider.
  Future<SubscriptionView> verifyPurchase({
    required BillingProvider provider,
    required String productId,
    required String receipt,
  }) async {
    final body = await _client.post(
      '/v1/purchases/verify',
      body: {
        'provider': provider.wireName,
        'productId': productId,
        'receipt': receipt,
      },
    );
    return _parse(body, SubscriptionView.fromJson);
  }

  // Devices ------------------------------------------------------------------

  Future<List<Device>> devices() async =>
      _parseList(await _client.get('/v1/me/devices'), Device.fromJson);

  /// `201` for a new device, `200` when this user already registered the
  /// installation. Throws `DEVICE_LIMIT_REACHED` (409) or `DEVICE_REVOKED`.
  Future<Device> registerDevice({
    required String installationId,
    required DevicePlatform platform,
    required String name,
  }) async {
    final body = await _client.post(
      '/v1/me/devices',
      body: {
        'installationId': installationId,
        'platform': platform.wireName,
        'name': name,
      },
    );
    return _parse(body, Device.fromJson);
  }

  Future<void> removeDevice(String deviceId) async {
    await _client.delete('/v1/me/devices/${Uri.encodeComponent(deviceId)}');
  }

  // Playback -----------------------------------------------------------------

  /// [supportedDrm] lists the DRM systems this device can play (optional in
  /// the contract), e.g. `["widevine"]` on Android.
  Future<PlaybackAuthorization> startPlayback({
    required String contentId,
    required String deviceId,
    List<DrmSystem> supportedDrm = const [],
  }) async {
    final body = await _client.post(
      '/v1/playback/sessions',
      body: {
        'contentId': contentId,
        'deviceId': deviceId,
        if (supportedDrm.isNotEmpty)
          'supportedDrm': [for (final system in supportedDrm) system.wireName],
      },
    );
    return _parse(body, PlaybackAuthorization.fromJson);
  }

  /// Returns the extended authorization expiry.
  Future<DateTime> heartbeat(
    String playbackSessionId, {
    int? positionSeconds,
  }) async {
    final body = await _client.post(
      '/v1/playback/sessions/${Uri.encodeComponent(playbackSessionId)}/heartbeat',
      body: {'positionSeconds': ?positionSeconds},
    );
    return _parse(body, (json) => readDateTime(json, 'expiresAt'));
  }

  Future<void> endPlayback(String playbackSessionId) async {
    await _client.delete(
      '/v1/playback/sessions/${Uri.encodeComponent(playbackSessionId)}',
    );
  }

  // Parsing ------------------------------------------------------------------

  static T _parse<T>(Object? body, T Function(Json json) parse) {
    try {
      return parse(asJson(body, 'response'));
    } on FormatException catch (error) {
      throw _unexpected(error);
    }
  }

  static List<T> _parseList<T>(Object? body, T Function(Json json) parse) {
    try {
      return asJsonList(body, 'response')
          .map((item) => parse(asJson(item, 'response[]')))
          .toList(growable: false);
    } on FormatException catch (error) {
      throw _unexpected(error);
    }
  }

  static ApiException _unexpected(FormatException error) => ApiException(
    code: ApiErrorCode.unexpectedResponse,
    statusCode: null,
    message: 'Unexpected response from the server: ${error.message}',
  );
}
