import 'dart:async';

import 'package:dio/dio.dart';

import '../storage/secure_store.dart';
import 'json.dart';
import 'models.dart';

/// `RequestOptions.extra` key: send the request without a bearer token and
/// never try to refresh on its behalf (login, register, refresh, public data).
const kSkipAuth = 'streamingapp.skipAuth';

/// `RequestOptions.extra` key marking a request already retried after a
/// refresh, so a second 401 is returned instead of looping.
const kRetriedAfterRefresh = 'streamingapp.retriedAfterRefresh';

/// Adds `Authorization: Bearer <accessToken>` and, on `401 UNAUTHENTICATED`,
/// refreshes the session once and retries the request once.
///
/// The refresh is single-flight: concurrent 401s wait for the same
/// `POST /v1/auth/refresh` call, because the API rotates refresh tokens and
/// treats a reused one as theft (revoking the whole session family).
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required this._retryClient,
    required this._refreshClient,
    required this._tokenStore,
    this._onSessionExpired,
  });

  final Dio _retryClient;
  final Dio _refreshClient;
  final TokenStore _tokenStore;
  final void Function()? _onSessionExpired;

  Future<Tokens?>? _inFlightRefresh;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (options.extra[kSkipAuth] != true) {
      final tokens = await _tokenStore.readTokens();
      if (tokens != null) {
        options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
      }
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final options = err.requestOptions;
    if (!_isUnauthenticated(err.response) ||
        options.extra[kSkipAuth] == true ||
        options.extra[kRetriedAfterRefresh] == true) {
      handler.next(err);
      return;
    }

    final Tokens? fresh;
    try {
      fresh = await _freshTokens(options.headers['Authorization']);
    } on DioException catch (refreshError) {
      // The refresh itself could not complete (offline, timeout, 5xx): keep
      // the session and report the transport problem for this request.
      handler.next(
        DioException(
          requestOptions: options,
          type: refreshError.type,
          error: refreshError.error,
          message: 'Session refresh failed',
        ),
      );
      return;
    } on FormatException {
      handler.next(err);
      return;
    }

    if (fresh == null) {
      handler.next(err);
      return;
    }

    final retry = options.copyWith(
      headers: {
        ...options.headers,
        'Authorization': 'Bearer ${fresh.accessToken}',
      },
      extra: {...options.extra, kRetriedAfterRefresh: true},
    );
    try {
      handler.resolve(await _retryClient.fetch<dynamic>(retry));
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }

  /// Returns tokens to retry with, or null when the session is gone.
  Future<Tokens?> _freshTokens(Object? sentAuthorization) async {
    final current = await _tokenStore.readTokens();
    if (current == null) return null; // signed out meanwhile
    if (sentAuthorization != 'Bearer ${current.accessToken}') {
      // Another request already refreshed after this one was sent.
      return current;
    }
    return _inFlightRefresh ??= _refresh(current.refreshToken)
        .whenComplete(() => _inFlightRefresh = null);
  }

  Future<Tokens?> _refresh(String refreshToken) async {
    try {
      final response = await _refreshClient.post<dynamic>(
        '/v1/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(extra: {kSkipAuth: true}),
      );
      final body = asJson(response.data, 'refresh response');
      final tokens = Tokens.fromJson(asJson(body['tokens'], 'tokens'));
      await _tokenStore.writeTokens(tokens);
      return tokens;
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status != null && status >= 400 && status < 500) {
        // Refresh token rejected (expired, revoked or reused): the session is
        // over. Clear it and let the app route to the login screen.
        await _tokenStore.clearTokens();
        _onSessionExpired?.call();
        return null;
      }
      rethrow;
    }
  }

  static bool _isUnauthenticated(Response<dynamic>? response) {
    if (response?.statusCode != 401) return false;
    final body = response?.data;
    return body is Map && body['code'] == 'UNAUTHENTICATED';
  }
}
