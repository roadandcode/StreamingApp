import 'package:dio/dio.dart';

import '../storage/secure_store.dart';
import 'api_exception.dart';
import 'auth_interceptor.dart';

/// Thin JSON client over dio.
///
/// * Adds the bearer token and refreshes expired sessions (see
///   [AuthInterceptor]).
/// * Converts every failure into an [ApiException].
/// * Deliberately has no logging interceptor: requests carry tokens and
///   responses carry signed manifest URLs.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required TokenStore tokenStore,
    void Function()? onSessionExpired,
    HttpClientAdapter? httpClientAdapter,
  }) : dio = Dio(_options(baseUrl)),
       _refreshDio = Dio(_options(baseUrl)) {
    if (httpClientAdapter != null) {
      dio.httpClientAdapter = httpClientAdapter;
      _refreshDio.httpClientAdapter = httpClientAdapter;
    }
    dio.interceptors.add(
      AuthInterceptor(
        retryClient: dio,
        refreshClient: _refreshDio,
        tokenStore: tokenStore,
        onSessionExpired: onSessionExpired,
      ),
    );
  }

  final Dio dio;

  /// Separate instance without the auth interceptor, used only to refresh.
  final Dio _refreshDio;

  static BaseOptions _options(String baseUrl) => BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 15),
    sendTimeout: const Duration(seconds: 20),
    receiveTimeout: const Duration(seconds: 20),
    contentType: Headers.jsonContentType,
    responseType: ResponseType.json,
    headers: {'Accept': 'application/json'},
  );

  Future<Object?> get(
    String path, {
    Map<String, Object?>? query,
    bool authenticated = true,
  }) => _send(
    () => dio.get<Object?>(
      path,
      queryParameters: _withoutNulls(query),
      options: _requestOptions(authenticated),
    ),
  );

  Future<Object?> post(
    String path, {
    Object? body,
    bool authenticated = true,
  }) => _send(
    () => dio.post<Object?>(
      path,
      data: body,
      options: _requestOptions(authenticated),
    ),
  );

  Future<Object?> delete(String path, {bool authenticated = true}) => _send(
    () => dio.delete<Object?>(path, options: _requestOptions(authenticated)),
  );

  Future<Object?> _send(Future<Response<Object?>> Function() request) async {
    try {
      final response = await request();
      return response.data;
    } on DioException catch (error) {
      throw ApiException.fromDioException(error);
    }
  }

  static Options _requestOptions(bool authenticated) =>
      Options(extra: {kSkipAuth: !authenticated});

  static Map<String, Object?>? _withoutNulls(Map<String, Object?>? query) {
    if (query == null) return null;
    return {
      for (final entry in query.entries)
        if (entry.value != null) entry.key: entry.value,
    };
  }

  void close() {
    dio.close(force: true);
    _refreshDio.close(force: true);
  }
}
