import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:streamingapp/core/api/api_exception.dart';
import 'package:streamingapp/core/api/error_messages.dart';

void main() {
  final request = RequestOptions(path: '/v1/me');

  DioException withResponse(int status, Object? body) => DioException(
    requestOptions: request,
    type: DioExceptionType.badResponse,
    response: Response<Object?>(
      requestOptions: request,
      statusCode: status,
      data: body,
    ),
  );

  group('ApiException.fromDioException', () {
    test('maps the contract error shape', () {
      final error = ApiException.fromDioException(
        withResponse(409, {
          'statusCode': 409,
          'code': 'DEVICE_LIMIT_REACHED',
          'message': 'Too many devices.',
        }),
      );
      expect(error.code, ApiErrorCode.deviceLimitReached);
      expect(error.statusCode, 409);
      expect(error.message, 'Too many devices.');
    });

    test('joins a list of validation messages', () {
      final error = ApiException.fromDioException(
        withResponse(400, {
          'statusCode': 400,
          'code': 'VALIDATION_FAILED',
          'message': ['email must be an email', 'password is too short'],
        }),
      );
      expect(error.code, ApiErrorCode.validationFailed);
      expect(error.message, 'email must be an email\npassword is too short');
    });

    test('keeps the HTTP status for bodies outside the contract', () {
      final error = ApiException.fromDioException(
        withResponse(502, '<html>Bad gateway</html>'),
      );
      expect(error.code, ApiErrorCode.unknown);
      expect(error.statusCode, 502);
    });

    test('no response means a network error', () {
      for (final type in [
        DioExceptionType.connectionTimeout,
        DioExceptionType.receiveTimeout,
        DioExceptionType.connectionError,
        DioExceptionType.unknown,
      ]) {
        final error = ApiException.fromDioException(
          DioException(requestOptions: request, type: type),
        );
        expect(error.code, ApiErrorCode.networkError, reason: type.name);
        expect(error.statusCode, isNull);
        expect(error.isNetworkError, isTrue);
      }
    });

    test('cancelled requests', () {
      final error = ApiException.fromDioException(
        DioException(requestOptions: request, type: DioExceptionType.cancel),
      );
      expect(error.code, ApiErrorCode.requestCancelled);
    });

    test('403s are flagged so playback stops', () {
      final error = ApiException.fromDioException(
        withResponse(403, {
          'statusCode': 403,
          'code': 'CONCURRENT_STREAM_LIMIT',
          'message': '',
        }),
      );
      expect(error.isForbidden, isTrue);
    });
  });

  group('describeError', () {
    ApiException withCode(String code, [int? status]) =>
        ApiException(code: code, statusCode: status, message: '');

    test('uses the code, not the server message', () {
      expect(
        describeError(withCode(ApiErrorCode.invalidCredentials, 401)),
        'Incorrect email or password.',
      );
      expect(
        describeError(withCode(ApiErrorCode.emailTaken, 409)),
        contains('already exists'),
      );
      expect(
        describeError(withCode(ApiErrorCode.concurrentStreamLimit, 403)),
        contains('Too many screens'),
      );
      expect(
        describeError(withCode(ApiErrorCode.networkError)),
        contains("Can't reach"),
      );
    });

    test('unknown codes fall back by status', () {
      expect(
        describeError(withCode('SOMETHING_NEW', 503)),
        contains('server is having trouble'),
      );
      expect(
        describeError(withCode('SOMETHING_NEW', 418)),
        'Something went wrong. Please try again.',
      );
      expect(
        describeError(StateError('x')),
        'Something went wrong. Please try again.',
      );
    });
  });
}
