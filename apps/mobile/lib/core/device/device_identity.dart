import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../api/models.dart';

/// Describes this device for `POST /v1/me/devices`.
class DeviceIdentity {
  DeviceIdentity({DeviceInfoPlugin? plugin, this._platform})
    : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;
  final TargetPlatform? _platform;

  TargetPlatform get _target => _platform ?? defaultTargetPlatform;

  DevicePlatform get platform => _target == TargetPlatform.iOS
      ? DevicePlatform.ios
      : DevicePlatform.android;

  /// A readable name such as "Google Pixel 8" or "iPhone 15 Pro".
  Future<String> deviceName() async {
    try {
      if (_target == TargetPlatform.iOS) {
        final info = await _plugin.iosInfo;
        final model = info.modelName.isNotEmpty ? info.modelName : info.model;
        return _clean(model, fallback: 'iPhone');
      }
      final info = await _plugin.androidInfo;
      final manufacturer = _capitalize(info.manufacturer.trim());
      final model = info.model.trim();
      final name = model.toLowerCase().startsWith(manufacturer.toLowerCase())
          ? model
          : '$manufacturer $model';
      return _clean(name, fallback: 'Android device');
    } on Object {
      // Plugin unavailable (e.g. tests): a generic name is good enough.
      return platform == DevicePlatform.ios ? 'iPhone' : 'Android device';
    }
  }

  static String _capitalize(String value) =>
      value.isEmpty ? value : '${value[0].toUpperCase()}${value.substring(1)}';

  static String _clean(String value, {required String fallback}) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return fallback;
    return trimmed.length > 80 ? trimmed.substring(0, 80) : trimmed;
  }
}
