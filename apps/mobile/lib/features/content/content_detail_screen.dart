import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api/models.dart';
import '../../core/ui/status_views.dart';
import '../catalog/content_card.dart';
import '../subscription/subscription_providers.dart';
import 'content_providers.dart';

class ContentDetailScreen extends ConsumerWidget {
  const ContentDetailScreen({super.key, required this.contentId});

  final String contentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(contentDetailProvider(contentId));
    // Hint only: decides whether to show locks and route to the paywall.
    // Playback is authorized by the server either way.
    final hasAccess = ref.watch(subscriptionProvider).value?.hasAccess;

    return switch (detail) {
      AsyncData(:final value) => Scaffold(
        body: _DetailBody(
          content: value,
          hasAccess: hasAccess,
          onRefresh: () {
            ref.invalidate(subscriptionProvider);
            return ref.refresh(contentDetailProvider(contentId).future);
          },
        ),
      ),
      AsyncError(:final error) => Scaffold(
        appBar: AppBar(),
        body: ErrorView(
          error: error,
          onRetry: () => ref.invalidate(contentDetailProvider(contentId)),
        ),
      ),
      _ => Scaffold(appBar: AppBar(), body: const LoadingView()),
    };
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({
    required this.content,
    required this.hasAccess,
    required this.onRefresh,
  });

  final ContentDetail content;
  final bool? hasAccess;
  final Future<void> Function() onRefresh;

  bool _isLocked(ContentSummary item) => item.isPremium && hasAccess == false;

  void _open(BuildContext context, ContentSummary item) {
    if (_isLocked(item)) {
      context.push('/paywall');
    } else {
      context.push(
        Uri(
          path: '/play/${item.id}',
          queryParameters: {'title': item.title},
        ).toString(),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final locked = _isLocked(content);
    final duration = formatDuration(content.durationSeconds);
    final meta = [
      if (content.kind == ContentKind.course)
        '${content.children.length} lessons'
      else if (duration.isNotEmpty)
        duration,
      if (content.ageRating != null) content.ageRating!,
      if (content.defaultLanguage.isNotEmpty)
        content.defaultLanguage.toUpperCase(),
      if (content.subtitles.isNotEmpty) 'Subtitles',
    ];

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverAppBar(
            pinned: true,
            expandedHeight: 240,
            flexibleSpace: FlexibleSpaceBar(
              background: Stack(
                fit: StackFit.expand,
                children: [
                  Thumbnail(url: content.thumbnailUrl, kind: content.kind),
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.transparent, Colors.black87],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            sliver: SliverList.list(
              children: [
                Row(
                  children: [
                    TierBadge(item: content, locked: locked),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        meta.join('  •  '),
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(content.title, style: theme.textTheme.headlineSmall),
                const SizedBox(height: 12),
                if (content.playable)
                  FilledButton.icon(
                    key: const Key('detail.play'),
                    onPressed: () => _open(context, content),
                    icon: Icon(locked ? Icons.lock : Icons.play_arrow),
                    label: Text(locked ? 'Subscribe to watch' : 'Play'),
                  ),
                if (locked && content.kind == ContentKind.course) ...[
                  OutlinedButton.icon(
                    onPressed: () => context.push('/paywall'),
                    icon: const Icon(Icons.workspace_premium),
                    label: const Text('Subscribe to unlock all lessons'),
                  ),
                ],
                const SizedBox(height: 16),
                Text(content.description, style: theme.textTheme.bodyMedium),
                if (content.children.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Lessons', style: theme.textTheme.titleMedium),
                ],
              ],
            ),
          ),
          SliverList.builder(
            itemCount: content.children.length,
            itemBuilder: (context, index) {
              final lesson = content.children[index];
              final lessonLocked = _isLocked(lesson);
              final lessonDuration = formatDuration(lesson.durationSeconds);
              return ListTile(
                key: Key('lesson.${lesson.id}'),
                leading: CircleAvatar(child: Text('${index + 1}')),
                title: Text(lesson.title),
                subtitle: Text(
                  [
                    if (lessonDuration.isNotEmpty) lessonDuration,
                    lesson.isPremium ? 'Premium' : 'Free',
                  ].join('  •  '),
                ),
                trailing: Icon(
                  lessonLocked ? Icons.lock : Icons.play_circle_outline,
                ),
                onTap: () => _open(context, lesson),
              );
            },
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 32)),
        ],
      ),
    );
  }
}
