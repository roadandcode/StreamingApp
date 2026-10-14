import 'package:dio/dio.dart';

/// Stable error codes from the API contract, plus a few client-side codes for
/// failures that never reached the server.
abstract final class ApiErrorCode {
  static const validationFailed = 'VALIDATION_FAILED';
  static const invalidPurchase = 'INVALID_PURCHASE';
  static const unauthenticated = 'UNAUTHENTICATED';
  static const invalidCredentials = 'INVALID_CREDENTIALS';
  static const invalidRefreshToken = 'INVALID_REFRESH_TOKEN';
  static const invalidSignature = 'INVALID_SIGNATURE';
  static const forbidden = 'FORBIDDEN';
  static const accountInactive = 'ACCOUNT_INACTIVE';
  static const entitlementRequired = 'ENTITLEMENT_REQUIRED';
  static const regionNotAllowed = 'REGION_NOT_ALLOWED';
  static const contentNotPlayable = 'CONTENT_NOT_PLAYABLE';
  static const deviceNotRegistered = 'DEVICE_NOT_REGISTERED';
  static const deviceRevoked = 'DEVICE_REVOKED';
  static const concurrentStreamLimit = 'CONCURRENT_STREAM_LIMIT';
  static const playbackSessionEnded = 'PLAYBACK_SESSION_ENDED';
  static const notFound = 'NOT_FOUND';
  static const emailTaken = 'EMAIL_TAKEN';
  static const deviceLimitReached = 'DEVICE_LIMIT_REACHED';
  static const purchaseBelongsToOtherAccount =
      'PURCHASE_BELONGS_TO_OTHER_ACCOUNT';
  static const assetNotReady = 'ASSET_NOT_READY';
  static const rateLimited = 'RATE_LIMITED';
  static const providerNotConfigured = 'PROVIDER_NOT_CONFIGURED';

  // Client-side codes (never sent by the API).
  static const networkError = 'NETWORK_ERROR';
  static const requestCancelled = 'REQUEST_CANCELLED';
  static const unexpectedResponse = 'UNEXPECTED_RESPONSE';
  static const unknown = 'UNKNOWN_ERROR';
}

/// An API failure in the contract's `{statusCode, code, message}` shape.
///
/// Branch on [code]; [message] is for humans and may change.
class ApiException implements Exception {
  const ApiException({
    required this.code,
    required this.statusCode,
    required this.message,
  });

  /// Maps a dio failure to an [ApiException].
  factory ApiException.fromDioException(DioException error) {
    final response = error.response;
    if (response == null) {
      if (error.type == DioExceptionType.cancel) {
        return const ApiException(
          code: ApiErrorCode.requestCancelled,
          statusCode: null,
          message: 'The request was cancelled.',
        );
      }
      if (error.error is FormatException) {
        return const ApiException(
          code: ApiErrorCode.unexpectedResponse,
          statusCode: null,
          message: 'The server sent an unexpected response.',
        );
      }
      return const ApiException(
        code: ApiErrorCode.networkError,
        statusCode: null,
        message: 'Could not reach the server.',
      );
    }
    return ApiException.fromResponse(response.statusCode, response.data);
  }

  /// Parses an error body. Bodies that do not follow the contract keep the
  /// HTTP status and get [ApiErrorCode.unknown].
  factory ApiException.fromResponse(int? httpStatus, Object? body) {
    if (body is Map) {
      final code = body['code'];
      final status = body['statusCode'];
      if (code is String && code.isNotEmpty) {
        return ApiException(
          code: code,
          statusCode: status is num ? status.toInt() : httpStatus,
          message: _messageOf(body['message']),
        );
      }
    }
    return ApiException(
      code: ApiErrorCode.unknown,
      statusCode: httpStatus,
      message:
          'Unexpected server error${httpStatus == null ? '' : ' ($httpStatus)'}.',
    );
  }

  final String code;

  /// HTTP status, or null when the request never got a response.
  final int? statusCode;
  final String message;

  bool get isNetworkError => code == ApiErrorCode.networkError;

  /// Any 403 from a playback endpoint means "stop the player now".
  bool get isForbidden => statusCode == 403;

  static String _messageOf(Object? message) {
    if (message is String) return message;
    if (message is List) return message.whereType<String>().join('\n');
    return '';
  }

  @override
  String toString() => 'ApiException($statusCode $code)';
}
