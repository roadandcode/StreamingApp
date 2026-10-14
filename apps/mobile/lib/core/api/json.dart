/// Small helpers for hand-written, strictly typed JSON parsing.
///
/// Every reader throws a [FormatException] naming the offending field, so a
/// contract mismatch is reported clearly instead of as a cast error.
library;

typedef Json = Map<String, dynamic>;

Json asJson(Object? value, [String context = 'value']) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  throw FormatException('Expected a JSON object for $context', value);
}

List<Object?> asJsonList(Object? value, [String context = 'value']) {
  if (value is List) return value;
  throw FormatException('Expected a JSON array for $context', value);
}

String readString(Json json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Expected "$key" to be a string', value);
}

String? readNullableString(Json json, String key) {
  final value = json[key];
  if (value == null || value is String) return value as String?;
  throw FormatException('Expected "$key" to be a string or null', value);
}

int readInt(Json json, String key) {
  final value = json[key];
  if (value is num) return value.toInt();
  throw FormatException('Expected "$key" to be a number', value);
}

int? readNullableInt(Json json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is num) return value.toInt();
  throw FormatException('Expected "$key" to be a number or null', value);
}

bool readBool(Json json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw FormatException('Expected "$key" to be a boolean', value);
}

DateTime readDateTime(Json json, String key) {
  final value = readString(json, key);
  final parsed = DateTime.tryParse(value);
  if (parsed == null) {
    throw FormatException('Expected "$key" to be an ISO-8601 timestamp', value);
  }
  return parsed.toUtc();
}

DateTime? readNullableDateTime(Json json, String key) {
  if (json[key] == null) return null;
  return readDateTime(json, key);
}

Map<String, String> readStringMap(Json json, String key) {
  final result = <String, String>{};
  for (final entry in asJson(json[key], key).entries) {
    final value = entry.value;
    if (value is! String) {
      throw FormatException(
        'Expected "$key.${entry.key}" to be a string',
        value,
      );
    }
    result[entry.key] = value;
  }
  return Map.unmodifiable(result);
}

List<T> readList<T>(Json json, String key, T Function(Json item) parse) {
  return asJsonList(
    json[key],
    key,
  ).map((item) => parse(asJson(item, '$key[]'))).toList(growable: false);
}
