import 'package:flutter_test/flutter_test.dart';
import 'package:streamingapp/core/api/json.dart';
import 'package:streamingapp/core/api/models.dart';

import '../../support/fakes.dart';

void main() {
  group('AuthResult', () {
    test('parses user and tokens', () {
      final result = AuthResult.fromJson({
        'user': userJson(),
        'tokens': tokensJson(),
      });
      expect(result.user.id, 'user-1');
      expect(result.user.displayName, 'Asha');
      expect(result.user.role, Role.viewer);
      expect(result.user.accountStatus, AccountStatus.active);
      expect(result.user.createdAt, DateTime.utc(2026, 11, 1, 10));
      expect(result.tokens.accessToken, 'access-1');
      expect(result.tokens.refreshTokenExpiresAt, DateTime.utc(2026, 12, 12));
    });

    test('tokens round-trip through toJson and never print secrets', () {
      final tokens = testTokens(
        access: 'secret-access',
        refresh: 'secret-refresh',
      );
      final copy = Tokens.fromJson(tokens.toJson());
      expect(copy.accessToken, 'secret-access');
      expect(copy.refreshToken, 'secret-refresh');
      expect(tokens.toString(), isNot(contains('secret')));
    });
  });

  group('content', () {
    final summaryJson = {
      'id': 'lesson-2',
      'kind': 'lesson',
      'title': 'Lesson 2',
      'description': 'Second lesson',
      'accessTier': 'premium',
      'thumbnailUrl': null,
      'defaultLanguage': 'hi',
      'ageRating': 'UA 13+',
      'durationSeconds': 754,
    };

    test('ContentDetail keeps lesson order and subtitles', () {
      final detail = ContentDetail.fromJson({
        'id': 'course-1',
        'kind': 'course',
        'title': 'Course',
        'description': 'A course',
        'accessTier': 'free',
        'thumbnailUrl': 'https://cdn.example.com/c.jpg',
        'defaultLanguage': 'en',
        'ageRating': null,
        'durationSeconds': null,
        'parentId': null,
        'children': [
          {
            ...summaryJson,
            'id': 'lesson-1',
            'title': 'Lesson 1',
            'accessTier': 'free',
          },
          summaryJson,
        ],
        'subtitles': [
          {'language': 'hi', 'label': 'Hindi'},
        ],
        'playable': false,
      });

      expect(detail.kind, ContentKind.course);
      expect(detail.isPremium, isFalse);
      expect(detail.children.map((c) => c.id), ['lesson-1', 'lesson-2']);
      expect(detail.children[1].isPremium, isTrue);
      expect(detail.children[1].durationSeconds, 754);
      expect(detail.children[1].ageRating, 'UA 13+');
      expect(detail.subtitles.single.label, 'Hindi');
      expect(detail.playable, isFalse);
    });

    test('Paginated<ContentSummary>', () {
      final page = Paginated.fromJson({
        'items': [summaryJson],
        'page': 1,
        'pageSize': 20,
        'total': 57,
      }, ContentSummary.fromJson);
      expect(page.items.single.title, 'Lesson 2');
      expect(page.total, 57);
    });

    test('unknown enum values do not crash older apps', () {
      final item = ContentSummary.fromJson({
        ...summaryJson,
        'kind': 'podcast',
        'accessTier': 'platinum',
      });
      expect(item.kind, ContentKind.unknown);
      expect(item.accessTier, AccessTier.unknown);
      expect(
        item.isPremium,
        isTrue,
        reason: 'unknown tiers are treated as locked hints',
      );
    });

    test('a missing required field is a FormatException naming the field', () {
      expect(
        () => ContentSummary.fromJson({...summaryJson}..remove('title')),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'message',
            contains('"title"'),
          ),
        ),
      );
    });
  });

  group('subscription and plans', () {
    test('SubscriptionView with snake_case status', () {
      final view = SubscriptionView.fromJson({
        'status': 'grace_period',
        'hasAccess': true,
        'accessTier': 'premium',
        'planCode': 'premium_monthly',
        'provider': 'google',
        'accessUntil': '2026-12-01T00:00:00.000Z',
        'autoRenewEnabled': true,
      });
      expect(view.status, SubscriptionStatus.gracePeriod);
      expect(view.hasAccess, isTrue);
      expect(view.provider, BillingProvider.google);
      expect(view.accessUntil, DateTime.utc(2026, 12));
    });

    test('a never-subscribed user', () {
      final view = subscriptionView();
      expect(view.status, SubscriptionStatus.none);
      expect(view.hasAccess, isFalse);
      expect(view.provider, isNull);
      expect(view.accessUntil, isNull);
    });

    test('Plan exposes the product id per store', () {
      final plan = premiumPlan();
      expect(plan.billingPeriodLabel, 'Monthly');
      expect(plan.productIdFor(BillingProvider.google), 'premium_monthly_play');
      expect(plan.productIdFor(BillingProvider.apple), 'premium_monthly_ios');
      expect(plan.productIdFor(BillingProvider.fake), 'fake_premium_monthly');
    });
  });

  group('devices and playback', () {
    test('Device', () {
      final device = testDevice();
      expect(device.platform, DevicePlatform.android);
      expect(device.revokedAt, isNull);
    });

    test('PlaybackAuthorization without DRM (fake media provider)', () {
      final auth = playbackAuthorization(heartbeatIntervalSeconds: 15);
      expect(auth.drm, isNull);
      expect(auth.heartbeatIntervalSeconds, 15);
      expect(auth.toString(), isNot(contains('manifest')));
      expect(auth.toString(), isNot(contains('sig=')));
    });

    test('PlaybackAuthorization with FairPlay DRM', () {
      final auth = playbackAuthorization(
        drm: {
          'system': 'fairplay',
          'licenseUrl': 'https://drm.example.com/license',
          'certificateUrl': 'https://drm.example.com/cert',
          'token': 'license-token',
        },
      );
      expect(auth.drm?.system, DrmSystem.fairplay);
      expect(auth.drm?.certificateUrl, 'https://drm.example.com/cert');
      expect(auth.toString(), isNot(contains('license-token')));
    });
  });

  test('asJson rejects non-objects', () {
    expect(() => asJson([1, 2]), throwsFormatException);
  });
}
