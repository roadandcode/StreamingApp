import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../api/json.dart';
import '../api/models.dart';

/// Minimal key-value interface so the secure store can be replaced in tests.
abstract interface class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Platform secure storage: Keychain on iOS, Keystore-backed encryption on
/// Android.
class FlutterSecureKeyValueStore implements KeyValueStore {
  FlutterSecureKeyValueStore([FlutterSecureStorage? storage])
    : _storage =
          storage ??
          const FlutterSecureStorage(
            // Readable after the first unlock so background work (e.g. a
            // token refresh) succeeds; never migrated to another device.
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// In-memory store used by tests.
class InMemoryKeyValueStore implements KeyValueStore {
  InMemoryKeyValueStore([Map<String, String>? initial])
    : values = {...?initial};

  final Map<String, String> values;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// Where the API client reads and persists the session tokens.
abstract interface class TokenStore {
  Future<Tokens?> readTokens();
  Future<void> writeTokens(Tokens tokens);
  Future<void> clearTokens();
}

/// Session tokens and the app's installation id, kept in secure storage.
///
/// Tokens are cached in memory after the first read. Never log them.
class SecureStore implements TokenStore {
  SecureStore(this._store, {this._uuid = const Uuid()});

  static const tokensKey = 'session.tokens';
  static const installationIdKey = 'device.installationId';

  final KeyValueStore _store;
  final Uuid _uuid;

  Tokens? _tokens;
  bool _tokensLoaded = false;
  Future<String>? _installationId;

  @override
  Future<Tokens?> readTokens() async {
    if (_tokensLoaded) return _tokens;
    final raw = await _store.read(tokensKey);
    Tokens? tokens;
    if (raw != null) {
      try {
        tokens = Tokens.fromJson(asJson(jsonDecode(raw), 'stored tokens'));
      } on FormatException {
        // Corrupt or from an incompatible version: treat as signed out.
        await _store.delete(tokensKey);
      }
    }
    // A concurrent write may have happened while reading; it wins.
    if (!_tokensLoaded) {
      _tokens = tokens;
      _tokensLoaded = true;
    }
    return _tokens;
  }

  @override
  Future<void> writeTokens(Tokens tokens) async {
    _tokens = tokens;
    _tokensLoaded = true;
    await _store.write(tokensKey, jsonEncode(tokens.toJson()));
  }

  @override
  Future<void> clearTokens() async {
    _tokens = null;
    _tokensLoaded = true;
    await _store.delete(tokensKey);
  }

  /// A random UUID generated once per installation and kept for the life of
  /// the install. Identifies this device to `POST /v1/me/devices`.
  Future<String> installationId() {
    return _installationId ??= _loadOrCreateInstallationId().catchError((
      Object error,
      StackTrace stackTrace,
    ) {
      _installationId = null; // let a later call retry
      Error.throwWithStackTrace(error, stackTrace);
    });
  }

  Future<String> _loadOrCreateInstallationId() async {
    final existing = await _store.read(installationIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final created = _uuid.v4();
    await _store.write(installationIdKey, created);
    return created;
  }
}

final keyValueStoreProvider = Provider<KeyValueStore>(
  (ref) => FlutterSecureKeyValueStore(),
);

final secureStoreProvider = Provider<SecureStore>(
  (ref) => SecureStore(ref.watch(keyValueStoreProvider)),
);
