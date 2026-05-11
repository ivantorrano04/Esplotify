import 'dart:async';
import 'dart:ffi';
import 'dart:io';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:path/path.dart';
import 'package:crypto/crypto.dart';
import 'dart:convert';

class User {
  final int? id;
  final String username;
  final String email;
  final String passwordHash;
  final DateTime createdAt;
  final String? birthdate;
  final String? gender;
  final bool marketing;
  final bool terms;

  User({
    this.id,
    required this.username,
    required this.email,
    required this.passwordHash,
    DateTime? createdAt,
    this.birthdate,
    this.gender,
    this.marketing = false,
    this.terms = false,
  }) : createdAt = createdAt ?? DateTime.now();

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'username': username,
      'email': email,
      'password_hash': passwordHash,
      'created_at': createdAt.toIso8601String(),
      'birthdate': birthdate,
      'gender': gender,
      'marketing': marketing ? 1 : 0,
      'terms': terms ? 1 : 0,
    };
  }

  factory User.fromMap(Map<String, dynamic> map) {
    return User(
      id: map['id'],
      username: map['username'],
      email: map['email'],
      passwordHash: map['password_hash'],
      createdAt: DateTime.parse(map['created_at']),
      birthdate: map['birthdate'],
      gender: map['gender'],
      marketing: map['marketing'] == 1,
      terms: map['terms'] == 1,
    );
  }
}

class DatabaseHelper {
  static final DatabaseHelper _instance = DatabaseHelper._internal();
  static Database? _database;

  factory DatabaseHelper() => _instance;

  DatabaseHelper._internal();

  Future<void> _ensureUsersProfileColumns(Database db) async {
    final cols = await db.rawQuery("PRAGMA table_info(users)");
    final names = cols
        .map((c) => (c['name'] ?? '').toString().toLowerCase())
        .toSet();

    Future<void> addIfMissing(String name, String sqlTypeAndDefault) async {
      if (!names.contains(name.toLowerCase())) {
        await db.execute('ALTER TABLE users ADD COLUMN $name $sqlTypeAndDefault');
      }
    }

    await addIfMissing('birthdate', 'TEXT');
    await addIfMissing('gender', 'TEXT');
    await addIfMissing('marketing', 'INTEGER DEFAULT 0');
    await addIfMissing('terms', 'INTEGER DEFAULT 0');
  }

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    // En Windows, pre-cargar sqlite3.dll desde el directorio del ejecutable usando dart:ffi.
    // Esto garantiza que cuando sqflite_common_ffi intente abrir la biblioteca,
    // ya esté en memoria y Windows devuelva el handle existente.
    if (Platform.isWindows) {
      final exeDir = File(Platform.resolvedExecutable).parent.path;
      for (final name in ['sqlite3.dll', 'libsqlite3.dll']) {
        final dllPath = '$exeDir\\$name';
        if (File(dllPath).existsSync()) {
          try {
            DynamicLibrary.open(dllPath);
          } catch (_) {}
          break;
        }
      }
    }

    sqfliteFfiInit();
    final databaseFactory = databaseFactoryFfi;

    final configuredDataDir = (Platform.environment['ESPLOTIFY_DATA_DIR'] ?? '').trim();
    final dataDir = configuredDataDir.isNotEmpty
        ? configuredDataDir
        : join(Directory.current.path, 'data');
    final dbPath = join(dataDir, 'users.db');
    await Directory(dirname(dbPath)).create(recursive: true);

    if (configuredDataDir.isNotEmpty && !File(dbPath).existsSync()) {
      final legacyDbPath = join(Directory.current.path, 'data', 'users.db');
      final legacyDb = File(legacyDbPath);
      if (legacyDb.existsSync()) {
        try {
          legacyDb.copySync(dbPath);
        } catch (_) {}
      }
    }

    return await databaseFactory.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: 9,
        onCreate: _onCreate,
        onUpgrade: _onUpgrade,
        onOpen: (db) async {
          await _ensureUsersProfileColumns(db);
        },
      ),
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        birthdate TEXT,
        gender TEXT,
        marketing INTEGER DEFAULT 0,
        terms INTEGER DEFAULT 0
      )
    ''');

    await db.execute('''
      CREATE TABLE playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    ''');

    await db.execute('''
      CREATE TABLE playlist_songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        song_title TEXT NOT NULL,
        song_author TEXT NOT NULL,
        song_duration INTEGER NOT NULL,
        song_thumbnail TEXT NOT NULL,
        added_at TEXT NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
      )
    ''');

    await db.execute('''
      CREATE TABLE audio_urls (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE recently_played (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        song_title TEXT NOT NULL,
        song_author TEXT NOT NULL,
        song_duration INTEGER NOT NULL,
        song_thumbnail TEXT NOT NULL,
        played_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user_id, song_id)
      )
    ''');

    await db.execute('''
      CREATE TABLE auto_generated_playlists (
        id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        songs TEXT NOT NULL, -- JSON string
        owner TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_updated TEXT NOT NULL,
        PRIMARY KEY (id, user_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    ''');

    await db.execute('''
      CREATE TABLE followed_artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        artist_name TEXT NOT NULL,
        followed_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user_id, artist_name)
      )
    ''');

    await db.execute('''
      CREATE TABLE liked_songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        song_title TEXT NOT NULL,
        song_author TEXT NOT NULL,
        song_duration INTEGER NOT NULL,
        song_thumbnail TEXT NOT NULL,
        liked_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user_id, song_id)
      )
    ''');
  }

  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS playlists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      ''');

      await db.execute('''
        CREATE TABLE IF NOT EXISTS playlist_songs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          playlist_id INTEGER NOT NULL,
          song_id TEXT NOT NULL,
          song_title TEXT NOT NULL,
          song_author TEXT NOT NULL,
          song_duration INTEGER NOT NULL,
          song_thumbnail TEXT NOT NULL,
          added_at TEXT NOT NULL,
          FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE
        )
      ''');
    }
    if (oldVersion < 3) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS audio_urls (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      ''');
    }
    if (oldVersion < 4) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS recently_played (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          song_id TEXT NOT NULL,
          song_title TEXT NOT NULL,
          song_author TEXT NOT NULL,
          song_duration INTEGER NOT NULL,
          song_thumbnail TEXT NOT NULL,
          played_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          UNIQUE(user_id, song_id)
        )
      ''');
    }
    if (oldVersion < 5) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS auto_generated_playlists (
          id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          songs TEXT NOT NULL,
          owner TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_updated TEXT NOT NULL,
          PRIMARY KEY (id, user_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      ''');
    }
    if (oldVersion < 6) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS liked_songs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          song_id TEXT NOT NULL,
          song_title TEXT NOT NULL,
          song_author TEXT NOT NULL,
          song_duration INTEGER NOT NULL,
          song_thumbnail TEXT NOT NULL,
          liked_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          UNIQUE(user_id, song_id)
        )
      ''');
    }
    if (oldVersion < 7) {
      // Recrear auto_generated_playlists con PRIMARY KEY compuesta (id, user_id)
      await db.execute('DROP TABLE IF EXISTS auto_generated_playlists');
      await db.execute('''
        CREATE TABLE auto_generated_playlists (
          id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          songs TEXT NOT NULL,
          owner TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_updated TEXT NOT NULL,
          PRIMARY KEY (id, user_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      ''');
    }
    if (oldVersion < 8) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS followed_artists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          artist_name TEXT NOT NULL,
          followed_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          UNIQUE(user_id, artist_name)
        )
      ''');
    }
    if (oldVersion < 9) {
      await _ensureUsersProfileColumns(db);
    }
  }

  Future<int> insertUser(User user) async {
    final db = await database;
    return await db.insert('users', user.toMap());
  }

  Future<User?> getUserByUsername(String username) async {
    final db = await database;
    final maps = await db.query(
      'users',
      where: 'username = ?',
      whereArgs: [username],
    );

    if (maps.isNotEmpty) {
      return User.fromMap(maps.first);
    }
    return null;
  }

  Future<User?> getUserByEmail(String email) async {
    final db = await database;
    final maps = await db.query(
      'users',
      where: 'email = ?',
      whereArgs: [email],
    );

    if (maps.isNotEmpty) {
      return User.fromMap(maps.first);
    }
    return null;
  }

  Future<bool> userExists(String username, String email) async {
    final db = await database;
    final result = await db.rawQuery('''
      SELECT COUNT(*) as count FROM users
      WHERE username = ? OR email = ?
    ''', [username, email]);

    final count = result.first['count'] as int;
    return count > 0;
  }

  String hashPassword(String password) {
    final bytes = utf8.encode(password);
    final hash = sha256.convert(bytes);
    return hash.toString();
  }

  bool verifyPassword(String password, String hash) {
    final hashedPassword = hashPassword(password);
    return hashedPassword == hash;
  }

  // Playlist methods
  Future<int> createPlaylist(int userId, String name) async {
    final db = await database;
    return await db.insert('playlists', {
      'user_id': userId,
      'name': name,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, dynamic>>> getUserPlaylists(int userId) async {
    final db = await database;
    final result = await db.rawQuery('''
      SELECT p.id, p.user_id, p.name, p.created_at,
             COUNT(ps.id) as song_count,
             MIN(ps.song_thumbnail) as cover
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
      WHERE p.user_id = ?
      GROUP BY p.id, p.user_id, p.name, p.created_at
      ORDER BY p.created_at DESC
    ''', [userId]);
    return result;
  }

  Future<int> addSongToPlaylist(int playlistId, Map<String, dynamic> song) async {
    final db = await database;
    return await db.insert('playlist_songs', {
      'playlist_id': playlistId,
      'song_id': song['id'],
      'song_title': song['title'],
      'song_author': song['author'],
      'song_duration': song['duration'],
      'song_thumbnail': song['thumbnail'],
      'added_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<Map<String, dynamic>>> getPlaylistSongs(int playlistId) async {
    final db = await database;
    return await db.query(
      'playlist_songs',
      where: 'playlist_id = ?',
      whereArgs: [playlistId],
      orderBy: 'added_at ASC',
    );
  }

  Future<int> deletePlaylist(int playlistId, int userId) async {
    final db = await database;
    return await db.delete(
      'playlists',
      where: 'id = ? AND user_id = ?',
      whereArgs: [playlistId, userId],
    );
  }

  Future<int> removeSongFromPlaylist(int playlistId, String songId) async {
    final db = await database;
    return await db.delete(
      'playlist_songs',
      where: 'playlist_id = ? AND song_id = ?',
      whereArgs: [playlistId, songId],
    );
  }

  Future<bool> isSongInPlaylist(int playlistId, String songId) async {
    final db = await database;
    final result = await db.rawQuery('''
      SELECT COUNT(*) as count FROM playlist_songs
      WHERE playlist_id = ? AND song_id = ?
    ''', [playlistId, songId]);
    final count = result.first['count'] as int;
    return count > 0;
  }

  Future<List<Map<String, dynamic>>> getPlaylistsContainingSong(int userId, String songId) async {
    final db = await database;
    return await db.rawQuery('''
      SELECT p.id, p.name, p.created_at
      FROM playlists p
      INNER JOIN playlist_songs ps ON ps.playlist_id = p.id
      WHERE p.user_id = ? AND ps.song_id = ?
      ORDER BY p.created_at DESC
    ''', [userId, songId]);
  }

  Future<int> clearPlaylistSongs(int playlistId) async {
    final db = await database;
    return await db.delete(
      'playlist_songs',
      where: 'playlist_id = ?',
      whereArgs: [playlistId],
    );
  }

  // Audio URL methods
  Future<int> insertAudioUrl(String id, String url) async {
    final db = await database;
    return await db.insert('audio_urls', {
      'id': id,
      'url': url,
      'created_at': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<String?> getAudioUrl(String id) async {
    final db = await database;
    final maps = await db.query(
      'audio_urls',
      where: 'id = ?',
      whereArgs: [id],
    );
    if (maps.isNotEmpty) {
      return maps.first['url'] as String;
    }
    return null;
  }

  Future<void> loadAudioUrlsIntoCache(Map<String, String> cache) async {
    final db = await database;
    final maps = await db.query('audio_urls');
    for (final map in maps) {
      cache[map['id'] as String] = map['url'] as String;
    }
  }

  // Recently played methods
  Future<int> addRecentlyPlayed(int userId, Map<String, dynamic> song) async {
    final db = await database;
    return await db.insert('recently_played', {
      'user_id': userId,
      'song_id': song['id'],
      'song_title': song['title'],
      'song_author': song['author'],
      'song_duration': song['duration'],
      'song_thumbnail': song['thumbnail'],
      'played_at': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<Map<String, dynamic>>> getRecentlyPlayed(int userId, {int limit = 20}) async {
    final db = await database;
    return await db.query(
      'recently_played',
      where: 'user_id = ?',
      whereArgs: [userId],
      orderBy: 'played_at DESC',
      limit: limit,
    );
  }

  // Auto-generated playlists methods
  Future<int> createAutoGeneratedPlaylist(int userId, String id, String name, String description, List<Map<String, dynamic>> songs, String owner) async {
    final db = await database;
    final songsJson = jsonEncode(songs);
    return await db.insert('auto_generated_playlists', {
      'id': id,
      'user_id': userId,
      'name': name,
      'description': description,
      'songs': songsJson,
      'owner': owner,
      'created_at': DateTime.now().toIso8601String(),
      'last_updated': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace); // upsert: crea o reemplaza
  }

  Future<List<Map<String, dynamic>>> getAutoGeneratedPlaylists(int userId) async {
    final db = await database;
    final maps = await db.query(
      'auto_generated_playlists',
      where: 'user_id = ?',
      whereArgs: [userId],
      orderBy: 'created_at DESC',
    );

    return maps.map((map) {
      final songsJson = map['songs'] as String;
      final songs = jsonDecode(songsJson) as List<dynamic>;
      return {
        ...map,
        'songs': songs.map((song) => song as Map<String, dynamic>).toList(),
      };
    }).toList();
  }

  Future<Map<String, dynamic>?> getAutoGeneratedPlaylist(String id, int userId) async {
    final db = await database;
    final maps = await db.query(
      'auto_generated_playlists',
      where: 'id = ? AND user_id = ?',
      whereArgs: [id, userId],
    );

    if (maps.isNotEmpty) {
      final map = maps.first;
      final songsJson = map['songs'] as String;
      final songs = jsonDecode(songsJson) as List<dynamic>;
      return {
        ...map,
        'songs': songs.map((song) => song as Map<String, dynamic>).toList(),
      };
    }
    return null;
  }

  Future<int> updateAutoGeneratedPlaylist(String id, int userId, List<Map<String, dynamic>> songs) async {
    final db = await database;
    final songsJson = jsonEncode(songs);
    return await db.update(
      'auto_generated_playlists',
      {
        'songs': songsJson,
        'last_updated': DateTime.now().toIso8601String(),
      },
      where: 'id = ? AND user_id = ?',
      whereArgs: [id, userId],
    );
  }

  Future<int> deleteAutoGeneratedPlaylist(String id, int userId) async {
    final db = await database;
    return await db.delete(
      'auto_generated_playlists',
      where: 'id = ? AND user_id = ?',
      whereArgs: [id, userId],
    );
  }

  // Followed artists methods
  Future<int> followArtist(int userId, String artistName) async {
    final db = await database;
    return await db.insert('followed_artists', {
      'user_id': userId,
      'artist_name': artistName,
      'followed_at': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<int> unfollowArtist(int userId, String artistName) async {
    final db = await database;
    return await db.delete(
      'followed_artists',
      where: 'user_id = ? AND artist_name = ?',
      whereArgs: [userId, artistName],
    );
  }

  Future<List<Map<String, dynamic>>> getFollowedArtists(int userId) async {
    final db = await database;
    return await db.query(
      'followed_artists',
      where: 'user_id = ?',
      whereArgs: [userId],
      orderBy: 'followed_at DESC',
    );
  }

  Future<bool> isArtistFollowed(int userId, String artistName) async {
    final db = await database;
    final result = await db.rawQuery('''
      SELECT COUNT(*) as count FROM followed_artists
      WHERE user_id = ? AND artist_name = ?
    ''', [userId, artistName]);
    final count = result.first['count'] as int;
    return count > 0;
  }

  // Liked songs methods
  Future<int> addLikedSong(int userId, Map<String, dynamic> song) async {
    final db = await database;
    return await db.insert('liked_songs', {
      'user_id': userId,
      'song_id': song['id'],
      'song_title': song['title'],
      'song_author': song['author'],
      'song_duration': song['duration'],
      'song_thumbnail': song['thumbnail'],
      'liked_at': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<int> removeLikedSong(int userId, String songId) async {
    final db = await database;
    return await db.delete(
      'liked_songs',
      where: 'user_id = ? AND song_id = ?',
      whereArgs: [userId, songId],
    );
  }

  Future<List<Map<String, dynamic>>> getLikedSongs(int userId) async {
    final db = await database;
    return await db.query(
      'liked_songs',
      where: 'user_id = ?',
      whereArgs: [userId],
      orderBy: 'liked_at DESC',
    );
  }

  Future<bool> isSongLiked(int userId, String songId) async {
    final db = await database;
    final result = await db.rawQuery('''
      SELECT COUNT(*) as count FROM liked_songs
      WHERE user_id = ? AND song_id = ?
    ''', [userId, songId]);
    final count = result.first['count'] as int;
    return count > 0;
  }
}
