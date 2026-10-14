import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api/models.dart';
import '../../core/ui/status_views.dart';
import '../subscription/subscription_providers.dart';
import 'catalog_providers.dart';
import 'content_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _refresh(WidgetRef ref) {
    ref.invalidate(subscriptionProvider);
    return ref.refresh(catalogProvider.future);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(catalogProvider);
    final hasAccess = ref.watch(subscriptionProvider).value?.hasAccess;

    return Scaffold(
      appBar: AppBar(
        title: const Text('StreamingApp'),
        actions: [
          if (hasAccess == false)
            TextButton(
              onPressed: () => context.push('/paywall'),
              child: const Text('Subscribe'),
            ),
          IconButton(
            tooltip: 'Account',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => context.push('/account'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _refresh(ref),
        child: switch (catalog) {
          AsyncData(:final value) => _CatalogBody(
            items: value,
            hasAccess: hasAccess,
          ),
          AsyncError(:final error) => _ScrollableFill(
            child: ErrorView(
              error: error,
              onRetry: () => ref.invalidate(catalogProvider),
            ),
          ),
          _ => const _ScrollableFill(child: LoadingView()),
        },
      ),
    );
  }
}

class _CatalogBody extends StatelessWidget {
  const _CatalogBody({required this.items, required this.hasAccess});

  final List<ContentSummary> items;
  final bool? hasAccess;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const _ScrollableFill(
        child: EmptyView(
          message: 'Nothing to watch yet. New titles are on their way.',
        ),
      );
    }
    final courses = items.where((i) => i.kind == ContentKind.course).toList();
    final videos = items.where((i) => i.kind != ContentKind.course).toList();
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        const _SectionHeader('Continue watching'),
        const _ContinueWatchingPlaceholder(),
        if (courses.isNotEmpty) ...[
          const _SectionHeader('Courses'),
          _Rail(items: courses, hasAccess: hasAccess),
        ],
        if (videos.isNotEmpty) ...[
          const _SectionHeader('Videos'),
          _Rail(items: videos, hasAccess: hasAccess),
        ],
      ],
    );
  }
}

class _Rail extends StatelessWidget {
  const _Rail({required this.items, required this.hasAccess});

  final List<ContentSummary> items;
  final bool? hasAccess;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 190,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final item = items[index];
          return ContentCard(
            item: item,
            locked: item.isPremium && hasAccess == false,
            onTap: () => context.push('/content/${item.id}'),
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);

  final String title;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 24, 16, 12),
    child: Text(title, style: Theme.of(context).textTheme.titleLarge),
  );
}

class _ContinueWatchingPlaceholder extends StatelessWidget {
  const _ContinueWatchingPlaceholder();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Card(
        child: ListTile(
          leading: const Icon(Icons.history),
          title: const Text('Pick up where you left off'),
          subtitle: Text(
            'Titles you start watching will appear here.',
            style: theme.textTheme.bodySmall,
          ),
        ),
      ),
    );
  }
}

/// Keeps pull-to-refresh working for loading, error and empty states.
class _ScrollableFill extends StatelessWidget {
  const _ScrollableFill({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      child: SizedBox(height: constraints.maxHeight, child: child),
    ),
  );
}
