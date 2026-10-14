import 'package:material_ui/material_ui.dart';

import '../../core/api/models.dart';
import '../../core/ui/status_views.dart';

/// Poster card used in the home rails.
class ContentCard extends StatelessWidget {
  const ContentCard({
    super.key,
    required this.item,
    required this.locked,
    required this.onTap,
    this.width = 220,
  });

  final ContentSummary item;

  /// Lock hint from `SubscriptionView.hasAccess`; the server still decides.
  final bool locked;
  final VoidCallback onTap;
  final double width;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final duration = formatDuration(item.durationSeconds);
    return SizedBox(
      width: width,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Thumbnail(url: item.thumbnailUrl, kind: item.kind),
                    Positioned(
                      left: 8,
                      top: 8,
                      child: TierBadge(item: item, locked: locked),
                    ),
                    if (item.kind == ContentKind.course)
                      const Positioned(
                        right: 8,
                        bottom: 8,
                        child: _Chip(icon: Icons.school, label: 'Course'),
                      )
                    else if (duration.isNotEmpty)
                      Positioned(
                        right: 8,
                        bottom: 8,
                        child: _Chip(label: duration),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              item.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleSmall,
            ),
          ],
        ),
      ),
    );
  }
}

class Thumbnail extends StatelessWidget {
  const Thumbnail({super.key, required this.url, required this.kind});

  final String? url;
  final ContentKind kind;

  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Icon(
        kind == ContentKind.course
            ? Icons.school_outlined
            : Icons.movie_outlined,
        size: 40,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
    );
    final src = url;
    if (src == null || src.isEmpty) return placeholder;
    return Image.network(
      src,
      fit: BoxFit.cover,
      errorBuilder: (context, error, stackTrace) => placeholder,
    );
  }
}

/// "Free" / "Premium" badge with a lock when the subscription hint says the
/// viewer has no access.
class TierBadge extends StatelessWidget {
  const TierBadge({super.key, required this.item, required this.locked});

  final ContentSummary item;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    if (!item.isPremium) return const _Chip(label: 'Free');
    return _Chip(
      icon: locked ? Icons.lock : Icons.workspace_premium,
      label: 'Premium',
      highlight: true,
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, this.icon, this.highlight = false});

  final String label;
  final IconData? icon;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final foreground = highlight ? scheme.onPrimary : Colors.white;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: highlight
            ? scheme.primary
            : Colors.black.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 14, color: foreground),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: TextStyle(
                color: foreground,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
