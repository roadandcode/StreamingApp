/// Typed models for the shared types in `docs/architecture/api-contract.md`.
///
/// Parsing is hand-written. Enum values the app does not know yet map to an
/// `unknown` member so a newer API never crashes an older app.
library;

import 'package:flutter/foundation.dart';

import 'json.dart';

T _enumFromWire<T extends Enum>(
  List<T> values,
  String? wire,
  String Function(T) wireOf,
  T fallback,
) {
  for (final value in values) {
    if (wireOf(value) == wire) return value;
  }
  return fallback;
}

enum Role {
  viewer,
  admin,
  unknown;

  static Role fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

enum AccountStatus {
  active,
  suspended,
  deleted,
  unknown;

  static AccountStatus fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

/// `course` is a container of lessons; `lesson` and `video` are playable.
enum ContentKind {
  course,
  lesson,
  video,
  unknown;

  static ContentKind fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

enum AccessTier {
  free,
  premium,
  unknown;

  static AccessTier fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

/// The contract's `Platform` type (renamed to avoid clashing with `dart:io`).
enum DevicePlatform {
  android,
  ios,
  web,
  unknown;

  String get wireName => name;

  static DevicePlatform fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

enum BillingProvider {
  apple,
  google,
  fake,
  unknown;

  String get wireName => name;

  static BillingProvider fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

enum SubscriptionStatus {
  none('none'),
  pending('pending'),
  active('active'),
  gracePeriod('grace_period'),
  billingRetry('billing_retry'),
  cancelled('cancelled'),
  expired('expired'),
  refunded('refunded'),
  revoked('revoked'),
  unknown('unknown');

  const SubscriptionStatus(this.wireName);

  final String wireName;

  static SubscriptionStatus fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.wireName, unknown);
}

enum DrmSystem {
  widevine,
  fairplay,
  unknown;

  String get wireName => name;

  static DrmSystem fromWire(String? wire) =>
      _enumFromWire(values, wire, (v) => v.name, unknown);
}

@immutable
class User {
  const User({
    required this.id,
    required this.email,
    required this.displayName,
    required this.role,
    required this.accountStatus,
    required this.createdAt,
  });

  factory User.fromJson(Json json) => User(
    id: readString(json, 'id'),
    email: readString(json, 'email'),
    displayName: readNullableString(json, 'displayName'),
    role: Role.fromWire(readNullableString(json, 'role')),
    accountStatus: AccountStatus.fromWire(
      readNullableString(json, 'accountStatus'),
    ),
    createdAt: readDateTime(json, 'createdAt'),
  );

  final String id;
  final String email;
  final String? displayName;
  final Role role;
  final AccountStatus accountStatus;
  final DateTime createdAt;
}

/// Access and refresh tokens. Never log or print an instance of this class.
@immutable
class Tokens {
  const Tokens({
    required this.accessToken,
    required this.accessTokenExpiresAt,
    required this.refreshToken,
    required this.refreshTokenExpiresAt,
  });

  factory Tokens.fromJson(Json json) => Tokens(
    accessToken: readString(json, 'accessToken'),
    accessTokenExpiresAt: readDateTime(json, 'accessTokenExpiresAt'),
    refreshToken: readString(json, 'refreshToken'),
    refreshTokenExpiresAt: readDateTime(json, 'refreshTokenExpiresAt'),
  );

  final String accessToken;
  final DateTime accessTokenExpiresAt;
  final String refreshToken;
  final DateTime refreshTokenExpiresAt;

  Json toJson() => {
    'accessToken': accessToken,
    'accessTokenExpiresAt': accessTokenExpiresAt.toIso8601String(),
    'refreshToken': refreshToken,
    'refreshTokenExpiresAt': refreshTokenExpiresAt.toIso8601String(),
  };

  @override
  String toString() => 'Tokens(<redacted>)';
}

/// Response of `POST /v1/auth/register` and `POST /v1/auth/login`.
@immutable
class AuthResult {
  const AuthResult({required this.user, required this.tokens});

  factory AuthResult.fromJson(Json json) => AuthResult(
    user: User.fromJson(asJson(json['user'], 'user')),
    tokens: Tokens.fromJson(asJson(json['tokens'], 'tokens')),
  );

  final User user;
  final Tokens tokens;
}

@immutable
class ContentSummary {
  const ContentSummary({
    required this.id,
    required this.kind,
    required this.title,
    required this.description,
    required this.accessTier,
    required this.thumbnailUrl,
    required this.defaultLanguage,
    required this.ageRating,
    required this.durationSeconds,
  });

  factory ContentSummary.fromJson(Json json) => ContentSummary(
    id: readString(json, 'id'),
    kind: ContentKind.fromWire(readNullableString(json, 'kind')),
    title: readString(json, 'title'),
    description: readNullableString(json, 'description') ?? '',
    accessTier: AccessTier.fromWire(readNullableString(json, 'accessTier')),
    thumbnailUrl: readNullableString(json, 'thumbnailUrl'),
    defaultLanguage: readNullableString(json, 'defaultLanguage') ?? '',
    ageRating: readNullableString(json, 'ageRating'),
    durationSeconds: readNullableInt(json, 'durationSeconds'),
  );

  final String id;
  final ContentKind kind;
  final String title;
  final String description;
  final AccessTier accessTier;
  final String? thumbnailUrl;

  /// BCP-47 tag, e.g. `hi` or `en`.
  final String defaultLanguage;

  /// e.g. `U` or `UA 13+`.
  final String? ageRating;
  final int? durationSeconds;

  /// Anything not explicitly free is treated as premium for UI hints. The
  /// server still authorizes every playback.
  bool get isPremium => accessTier != AccessTier.free;
}

@immutable
class SubtitleTrack {
  const SubtitleTrack({required this.language, required this.label});

  factory SubtitleTrack.fromJson(Json json) => SubtitleTrack(
    language: readString(json, 'language'),
    label: readString(json, 'label'),
  );

  final String language;
  final String label;
}

@immutable
class ContentDetail extends ContentSummary {
  const ContentDetail({
    required super.id,
    required super.kind,
    required super.title,
    required super.description,
    required super.accessTier,
    required super.thumbnailUrl,
    required super.defaultLanguage,
    required super.ageRating,
    required super.durationSeconds,
    required this.parentId,
    required this.children,
    required this.subtitles,
    required this.playable,
  });

  factory ContentDetail.fromJson(Json json) {
    final summary = ContentSummary.fromJson(json);
    return ContentDetail(
      id: summary.id,
      kind: summary.kind,
      title: summary.title,
      description: summary.description,
      accessTier: summary.accessTier,
      thumbnailUrl: summary.thumbnailUrl,
      defaultLanguage: summary.defaultLanguage,
      ageRating: summary.ageRating,
      durationSeconds: summary.durationSeconds,
      parentId: readNullableString(json, 'parentId'),
      children: json['children'] == null
          ? const []
          : readList(json, 'children', ContentSummary.fromJson),
      subtitles: json['subtitles'] == null
          ? const []
          : readList(json, 'subtitles', SubtitleTrack.fromJson),
      playable: json['playable'] == true,
    );
  }

  final String? parentId;

  /// Lessons of a course, already ordered by position by the API.
  final List<ContentSummary> children;
  final List<SubtitleTrack> subtitles;

  /// Whether the content has a ready video asset.
  final bool playable;
}

@immutable
class SubscriptionView {
  const SubscriptionView({
    required this.status,
    required this.hasAccess,
    required this.accessTier,
    required this.planCode,
    required this.provider,
    required this.accessUntil,
    required this.autoRenewEnabled,
  });

  factory SubscriptionView.fromJson(Json json) {
    final tier = readNullableString(json, 'accessTier');
    final provider = readNullableString(json, 'provider');
    return SubscriptionView(
      status: SubscriptionStatus.fromWire(readNullableString(json, 'status')),
      hasAccess: readBool(json, 'hasAccess'),
      accessTier: tier == null ? null : AccessTier.fromWire(tier),
      planCode: readNullableString(json, 'planCode'),
      provider: provider == null ? null : BillingProvider.fromWire(provider),
      accessUntil: readNullableDateTime(json, 'accessUntil'),
      autoRenewEnabled: json['autoRenewEnabled'] == true,
    );
  }

  final SubscriptionStatus status;

  /// The only field the app may use to show "premium unlocked" UI. It is a
  /// hint: the server authorizes every playback regardless.
  final bool hasAccess;
  final AccessTier? accessTier;
  final String? planCode;
  final BillingProvider? provider;
  final DateTime? accessUntil;
  final bool autoRenewEnabled;
}

@immutable
class StoreProductRef {
  const StoreProductRef({required this.provider, required this.productId});

  factory StoreProductRef.fromJson(Json json) => StoreProductRef(
    provider: BillingProvider.fromWire(readNullableString(json, 'provider')),
    productId: readString(json, 'productId'),
  );

  final BillingProvider provider;
  final String productId;
}

@immutable
class Plan {
  const Plan({
    required this.code,
    required this.name,
    required this.billingPeriod,
    required this.accessTier,
    required this.storeProducts,
  });

  factory Plan.fromJson(Json json) => Plan(
    code: readString(json, 'code'),
    name: readString(json, 'name'),
    billingPeriod: readString(json, 'billingPeriod'),
    accessTier: AccessTier.fromWire(readNullableString(json, 'accessTier')),
    storeProducts: json['storeProducts'] == null
        ? const []
        : readList(json, 'storeProducts', StoreProductRef.fromJson),
  );

  final String code;
  final String name;

  /// ISO-8601 duration: `P1M` or `P1Y`.
  final String billingPeriod;
  final AccessTier accessTier;
  final List<StoreProductRef> storeProducts;

  /// The store product id for [provider], if this plan is sold there.
  String? productIdFor(BillingProvider provider) {
    for (final product in storeProducts) {
      if (product.provider == provider) return product.productId;
    }
    return null;
  }

  String get billingPeriodLabel => switch (billingPeriod) {
    'P1M' => 'Monthly',
    'P1Y' => 'Yearly',
    _ => billingPeriod,
  };
}

@immutable
class Device {
  const Device({
    required this.id,
    required this.installationId,
    required this.platform,
    required this.name,
    required this.lastSeenAt,
    required this.createdAt,
    required this.revokedAt,
  });

  factory Device.fromJson(Json json) => Device(
    id: readString(json, 'id'),
    installationId: readString(json, 'installationId'),
    platform: DevicePlatform.fromWire(readNullableString(json, 'platform')),
    name: readString(json, 'name'),
    lastSeenAt: readDateTime(json, 'lastSeenAt'),
    createdAt: readDateTime(json, 'createdAt'),
    revokedAt: readNullableDateTime(json, 'revokedAt'),
  );

  final String id;
  final String installationId;
  final DevicePlatform platform;
  final String name;
  final DateTime lastSeenAt;
  final DateTime createdAt;
  final DateTime? revokedAt;
}

/// DRM parameters of a playback authorization. The license request headers
/// carry a short-lived license token: never log an instance of this class.
@immutable
class DrmConfig {
  const DrmConfig({
    required this.system,
    required this.licenseUrl,
    required this.certificateUrl,
    required this.licenseRequestHeaders,
  });

  factory DrmConfig.fromJson(Json json) => DrmConfig(
    system: DrmSystem.fromWire(readNullableString(json, 'system')),
    licenseUrl: readString(json, 'licenseUrl'),
    certificateUrl: readNullableString(json, 'certificateUrl'),
    licenseRequestHeaders: readStringMap(json, 'licenseRequestHeaders'),
  );

  final DrmSystem system;
  final String licenseUrl;

  /// FairPlay application certificate.
  final String? certificateUrl;

  /// Headers to send, exactly as given, on every license request. Their names
  /// depend on the DRM vendor, so they are never hardcoded in the app.
  final Map<String, String> licenseRequestHeaders;

  @override
  String toString() => 'DrmConfig(${system.name}, <redacted>)';
}

/// Response of `POST /v1/playback/sessions`. The manifest URL is short-lived
/// and signed: never log an instance of this class.
@immutable
class PlaybackAuthorization {
  const PlaybackAuthorization({
    required this.playbackSessionId,
    required this.contentId,
    required this.manifestUrl,
    required this.expiresAt,
    required this.heartbeatIntervalSeconds,
    required this.drm,
  });

  factory PlaybackAuthorization.fromJson(Json json) {
    final drm = json['drm'];
    return PlaybackAuthorization(
      playbackSessionId: readString(json, 'playbackSessionId'),
      contentId: readString(json, 'contentId'),
      manifestUrl: readString(json, 'manifestUrl'),
      expiresAt: readDateTime(json, 'expiresAt'),
      heartbeatIntervalSeconds: readInt(json, 'heartbeatIntervalSeconds'),
      drm: drm == null ? null : DrmConfig.fromJson(asJson(drm, 'drm')),
    );
  }

  final String playbackSessionId;
  final String contentId;
  final String manifestUrl;

  /// Authorization expiry; extended by each successful heartbeat.
  final DateTime expiresAt;
  final int heartbeatIntervalSeconds;

  /// `null` for unprotected development streams from the fake media provider.
  final DrmConfig? drm;

  @override
  String toString() =>
      'PlaybackAuthorization(session: $playbackSessionId, drm: ${drm?.system.name})';
}

/// The contract's `Paginated<T>` envelope.
@immutable
class Paginated<T> {
  const Paginated({
    required this.items,
    required this.page,
    required this.pageSize,
    required this.total,
  });

  factory Paginated.fromJson(Json json, T Function(Json item) parseItem) =>
      Paginated(
        items: readList(json, 'items', parseItem),
        page: readInt(json, 'page'),
        pageSize: readInt(json, 'pageSize'),
        total: readInt(json, 'total'),
      );

  final List<T> items;
  final int page;
  final int pageSize;
  final int total;
}
