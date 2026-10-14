import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_providers.dart';
import '../../core/api/models.dart';

/// Published top-level catalog items available in the viewer's country.
final catalogProvider = FutureProvider<List<ContentSummary>>((ref) async {
  final page = await ref.watch(streamingApiProvider).catalog(pageSize: 100);
  return page.items;
});
