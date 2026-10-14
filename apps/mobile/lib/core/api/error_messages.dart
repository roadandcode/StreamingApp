import 'api_exception.dart';

/// User-facing text for an error, chosen by the stable error `code`.
String describeError(Object error) {
  if (error is! ApiException) {
    return 'Something went wrong. Please try again.';
  }
  switch (error.code) {
    case ApiErrorCode.networkError:
      return "Can't reach the server. Check your connection and try again.";
    case ApiErrorCode.invalidCredentials:
      return 'Incorrect email or password.';
    case ApiErrorCode.emailTaken:
      return 'An account with this email already exists. Try signing in.';
    case ApiErrorCode.validationFailed:
      return error.message.isNotEmpty
          ? error.message
          : 'Some details are not valid. Please check and try again.';
    case ApiErrorCode.rateLimited:
      return 'Too many attempts. Please wait a moment and try again.';
    case ApiErrorCode.unauthenticated:
    case ApiErrorCode.invalidRefreshToken:
      return 'Your session has expired. Please sign in again.';
    case ApiErrorCode.accountInactive:
      return 'This account is suspended or deleted. Contact support for help.';
    case ApiErrorCode.entitlementRequired:
      return 'An active subscription is required to watch this.';
    case ApiErrorCode.regionNotAllowed:
      return 'This title is not available in your country.';
    case ApiErrorCode.contentNotPlayable:
      return 'This title is not ready to play yet.';
    case ApiErrorCode.deviceNotRegistered:
      return 'This device is not registered to your account.';
    case ApiErrorCode.deviceRevoked:
      return 'This device was removed from your account.';
    case ApiErrorCode.deviceLimitReached:
      return 'You have reached the maximum number of devices. Remove one to continue.';
    case ApiErrorCode.concurrentStreamLimit:
      return 'Too many screens are playing right now. Stop playback on another device and try again.';
    case ApiErrorCode.playbackSessionEnded:
      return 'This playback session has ended.';
    case ApiErrorCode.notFound:
      return 'This title is not available.';
    case ApiErrorCode.invalidPurchase:
      return 'The store could not confirm this purchase.';
    case ApiErrorCode.purchaseBelongsToOtherAccount:
      return 'This store subscription is already linked to a different account.';
    case ApiErrorCode.providerNotConfigured:
      return 'This service is not available yet. Please try again later.';
    case ApiErrorCode.unexpectedResponse:
      return 'The server sent an unexpected response. Please try again.';
    case ApiErrorCode.requestCancelled:
      return 'The request was cancelled.';
  }
  final status = error.statusCode;
  if (status != null && status >= 500) {
    return 'The server is having trouble. Please try again shortly.';
  }
  return 'Something went wrong. Please try again.';
}
