/// Client-side form validation. The server validates again; these checks only
/// give faster feedback.
abstract final class AuthValidators {
  /// Matches the contract: passwords have at least 10 characters.
  static const minPasswordLength = 10;

  static final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  static String? email(String? value) {
    final email = value?.trim() ?? '';
    if (email.isEmpty) return 'Enter your email address';
    if (!_email.hasMatch(email)) return 'Enter a valid email address';
    return null;
  }

  static String? password(String? value) {
    final password = value ?? '';
    if (password.isEmpty) return 'Enter your password';
    if (password.length < minPasswordLength) {
      return 'Password must be at least $minPasswordLength characters';
    }
    return null;
  }

  static String? displayName(String? value) {
    if ((value?.trim().length ?? 0) > 80) {
      return 'Name must be 80 characters or fewer';
    }
    return null;
  }
}
