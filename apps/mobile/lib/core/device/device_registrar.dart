import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../api/api_providers.dart';
import '../api/models.dart';
import '../api/streaming_api.dart';
import '../storage/secure_store.dart';
import 'device_identity.dart';

/// Outcome of registering this installation with `POST /v1/me/devices`.
sealed class DeviceRegistrationResult {
  const DeviceRegistrationResult();
}

/// `201` (new) or `200` (already registered by this user).
final class DeviceRegistered extends DeviceRegistrationResult {
  const DeviceRegistered(this.device);
  final Device device;
}

/// `409 DEVICE_LIMIT_REACHED`: the user must remove a device first.
final class DeviceLimitReached extends DeviceRegistrationResult {
  const DeviceLimitReached();
}

/// `403 DEVICE_REVOKED`: this installation was removed from the account.
final class DeviceRevoked extends DeviceRegistrationResult {
  const DeviceRevoked();
}

class DeviceRegistrar {
  DeviceRegistrar({
    required this._api,
    required this._store,
    required this._identity,
  });

  final StreamingApi _api;
  final SecureStore _store;
  final DeviceIdentity _identity;

  Future<String> installationId() => _store.installationId();

  /// Registers this installation. Other failures throw [ApiException].
  Future<DeviceRegistrationResult> register() async {
    final installationId = await _store.installationId();
    final name = await _identity.deviceName();
    try {
      final device = await _api.registerDevice(
        installationId: installationId,
        platform: _identity.platform,
        name: name,
      );
      return DeviceRegistered(device);
    } on ApiException catch (error) {
      switch (error.code) {
        case ApiErrorCode.deviceLimitReached:
          return const DeviceLimitReached();
        case ApiErrorCode.deviceRevoked:
          return const DeviceRevoked();
      }
      rethrow;
    }
  }
}

final deviceIdentityProvider = Provider<DeviceIdentity>(
  (ref) => DeviceIdentity(),
);

final deviceRegistrarProvider = Provider<DeviceRegistrar>(
  (ref) => DeviceRegistrar(
    api: ref.watch(streamingApiProvider),
    store: ref.watch(secureStoreProvider),
    identity: ref.watch(deviceIdentityProvider),
  ),
);
