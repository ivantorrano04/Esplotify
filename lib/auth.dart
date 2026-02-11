import 'package:dart_jsonwebtoken/dart_jsonwebtoken.dart';
import 'database.dart';

class AuthService {
  static const String _secretKey = 'your-secret-key-here-change-in-production';

  static String generateToken(User user) {
    final jwt = JWT({
      'id': user.id,
      'username': user.username,
      'email': user.email,
    });
    return jwt.sign(SecretKey(_secretKey),
        expiresIn: const Duration(days: 30));
  }

  static JWT? verifyToken(String token) {
    try {
      return JWT.verify(token, SecretKey(_secretKey));
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getUserFromToken(String token) async {
    final jwt = verifyToken(token);
    if (jwt == null) return null;

    final payload = jwt.payload as Map<String, dynamic>;
    final username = payload['username'] as String;

    final user = await DatabaseHelper().getUserByUsername(username);
    if (user == null) return null;

    return {
      'id': user.id,
      'username': user.username,
      'email': user.email,
    };
  }
}
