import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_providers.dart';
import '../../core/api/models.dart';

final contentDetailProvider = FutureProvider.autoDispose
    .family<ContentDetail, String>(
      (ref, id) => ref.watch(streamingApiProvider).content(id),
    );
