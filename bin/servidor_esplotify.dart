  import 'dart:async';
  import 'dart:convert';
  import 'dart:io';
  import 'package:shelf/shelf.dart';
  import 'package:shelf/shelf_io.dart' as shelf_io;
  import 'package:shelf_router/shelf_router.dart';
  import 'package:shelf_static/shelf_static.dart';
  import 'package:youtube_explode_dart/youtube_explode_dart.dart';
  import 'package:servidor_esplotify/database.dart';
  import 'package:servidor_esplotify/auth.dart';

  // ─── Log a fichero para diagnóstico en builds empaquetados ──────────────────
  IOSink? _logSink;
  void _initLog() {
    try {
      final dataDir = (Platform.environment['ESPLOTIFY_DATA_DIR'] ?? '').trim();
      if (dataDir.isNotEmpty) {
        final logFile = File('$dataDir/server.log');
        logFile.parent.createSync(recursive: true);
        _logSink = logFile.openWrite(mode: FileMode.append);
      }
    } catch (_) {}
  }
  void _log(String msg) {
    final line = '[${DateTime.now().toIso8601String()}] $msg';
    print(line);
    try { _logSink?.writeln(line); } catch (_) {}
  }

  // Instancia global reutilizable de YoutubeExplode (una sola, no por petición)
  final yt = YoutubeExplode();

  // ─── Cache en memoria con TTL ────────────────────────────────────────────────
  // URLs de YouTube expiran en ~6h. TTL de 5h para invalidar antes.
  final Map<String, String> _audioUrlCache = {};
  final Map<String, int> _audioUrlCacheTime = {};
  const int _cacheTtlMs = 5 * 60 * 60 * 1000;

  bool _isCacheEntryValid(String id) {
    final ts = _audioUrlCacheTime[id];
    if (ts == null) return false;
    return (DateTime.now().millisecondsSinceEpoch - ts) < _cacheTtlMs;
  }

  void _setCacheEntry(String id, String url) {
    _audioUrlCache[id] = url;
    _audioUrlCacheTime[id] = DateTime.now().millisecondsSinceEpoch;
  }

  void _removeCacheEntry(String id) {
    _audioUrlCache.remove(id);
    _audioUrlCacheTime.remove(id);
  }

  void _purgeExpiredCache() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final expired = _audioUrlCacheTime.entries
        .where((e) => (now - e.value) >= _cacheTtlMs)
        .map((e) => e.key)
        .toList();
    for (final id in expired) {
      _audioUrlCache.remove(id);
      _audioUrlCacheTime.remove(id);
    }
    if (expired.isNotEmpty) print('[cache] Purged ${expired.length} expired entries');
  }

  // ─── Search result cache (TTL: 1h) ──────────────────────────────────────────
  // Evita que búsquedas concurrentes idénticas golpeen YouTube varias veces.
  final Map<String, List<Map<String, dynamic>>> _searchCache = {};
  final Map<String, int> _searchCacheTime = {};
  final Map<String, Future<List<Map<String, dynamic>>>> _searchInFlight = {};
  const int _searchCacheTtlMs = 60 * 60 * 1000; // 1 hora

  List<Map<String, dynamic>> _getCachedSearch(String query) {
    final key = query.trim().toLowerCase();
    return _searchCache[key] ?? const [];
  }

  void _refreshSearchInBackground(String query) {
    final key = query.trim().toLowerCase();
    if (_searchInFlight.containsKey(key)) return;
    unawaited(_cachedYtSearch(query));
  }

  Future<List<Map<String, dynamic>>> _cachedYtSearch(String query) async {
    final key = query.trim().toLowerCase();
    final now = DateTime.now().millisecondsSinceEpoch;
    // Return cached if fresh
    if (_searchCache.containsKey(key) &&
        (now - (_searchCacheTime[key] ?? 0)) < _searchCacheTtlMs) {
      return _searchCache[key]!;
    }
    // Coalesce: if same query already in flight, share that future
    if (_searchInFlight.containsKey(key)) return _searchInFlight[key]!;
    final completer = Completer<List<Map<String, dynamic>>>();
    _searchInFlight[key] = completer.future;
    try {
      final results = await _ytSearch(query);
      _searchCache[key] = results;
      _searchCacheTime[key] = DateTime.now().millisecondsSinceEpoch;
      completer.complete(results);
    } catch (e) {
      completer.complete([]);
    } finally {
      _searchInFlight.remove(key);
    }
    return completer.future;
  }

  // ─── Request coalescing ──────────────────────────────────────────────────────
  // Si ya hay un fetch en vuelo para el mismo ID, devuelve el mismo Future
  // en lugar de lanzar una segunda petición a YouTube.
  final Map<String, Future<String>> _inFlightFetches = {};

  // Fetch real usando la instancia global yt (async-safe, no necesita isolate).
  // Orden de clientes: tv primero porque explícitamente ignora restricciones y usa
  // el endpoint interno (youtubei/v1/player), no el scraping de /watch?v=.
  // ios/android/androidVr son fallback para videos que tv no sirve.
  final _ytClients = [
    YoutubeApiClient.androidVr,  // 1º — único que funciona actualmente
    YoutubeApiClient.tv,         // Bypasses restrictions, no web scraping
    YoutubeApiClient.ios,        // Internal API, buena calidad
    YoutubeApiClient.android,    // Internal API, fallback
    YoutubeApiClient.mweb,       // Mobile web, último recurso
  ];

  Future<String> _doFetchAudioUrl(String id) async {
    Object? lastError;
    for (int i = 0; i < _ytClients.length; i++) {
      final client = _ytClients[i];
      try {
        final manifest = await yt.videos.streams
            .getManifest(id, ytClients: [client])
            .timeout(const Duration(seconds: 15));
        final url = manifest.audioOnly.withHighestBitrate().url.toString();
        if (url.isNotEmpty) {
          print('[fetch] OK con cliente ${i + 1}/${_ytClients.length} para $id');
          return url;
        }
      } catch (e) {
        lastError = e;
        // Solo loguear la primera línea para no saturar la consola
        print('[fetch] Cliente ${i + 1}/${_ytClients.length} falló para $id: ${e.toString().split('\n').first}');
      }
    }
    throw Exception('No se pudo obtener URL de audio para $id: $lastError');
  }

  // Punto de entrada unificado con cache + coalescing
  Future<String> getAudioUrl(String id) {
    // 1. Cache hit válido → respuesta instantánea
    if (_audioUrlCache.containsKey(id) && _isCacheEntryValid(id)) {
      print('[cache] HIT $id');
      return Future.value(_audioUrlCache[id]!);
    }
    _removeCacheEntry(id); // limpiar entrada expirada si existe

    // 2. Fetch ya en vuelo → reutilizar el mismo Future (coalescing)
    if (_inFlightFetches.containsKey(id)) {
      print('[cache] Coalescing request for $id');
      return _inFlightFetches[id]!;
    }

    // 3. Nuevo fetch
    print('[cache] MISS $id — fetching...');
    final future = _doFetchAudioUrl(id).then((url) {
      _setCacheEntry(id, url);
      print('[cache] STORED $id');
      return url;
    }).whenComplete(() {
      _inFlightFetches.remove(id);
    });

    _inFlightFetches[id] = future;
    return future;
  }

  // Prefetch secuencial en background: 2 canciones máximo con 2 s de pausa entre
  // ellas para no disparar el rate limiting de YouTube.
  void prefetchAudioUrls(List<String> ids) {
    Future(() async {
      for (final id in ids.take(2)) {
        if (_audioUrlCache.containsKey(id) && _isCacheEntryValid(id)) continue;
        await getAudioUrl(id).catchError((e) {
          print('[prefetch] Error $id: ${e.toString().split("\n").first}');
          return '';
        });
        await Future.delayed(const Duration(seconds: 2));
      }
    });
  }

  // Middleware CORS
  Response _cors(Response res) => res.change(headers: {
        ...res.headers,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, Content-Type, Range, Authorization',
      });

  Response _options(Request req) => Response.ok('', headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, Content-Type, Range, Authorization'
      });

  // Ruta de búsqueda
  /// Ejecuta una búsqueda en YouTube con reintentos automáticos.
  /// Usa searchContent() con whereType<SearchVideo>() para evitar el crash
  /// interno de la librería al construir objetos Video (e.uploadDate.toDateTime()).
  Future<List<Map<String, dynamic>>> _ytSearch(String query) async {
    try {
      final results = await yt.search.searchContent(
        query,
        filter: TypeFilters.video,
      );
      final allResults = <Map<String, dynamic>>[];
      for (final item in results.whereType<SearchVideo>()) {
        try {
          // Parsear duración "H:MM:SS" o "M:SS" → segundos
          int durationSecs = 0;
          try {
            final parts = item.duration.split(':').map(int.parse).toList();
            if (parts.length == 3) {
              durationSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length == 2) {
              durationSecs = parts[0] * 60 + parts[1];
            }
          } catch (_) {}

          String thumbnail = '';
          if (item.thumbnails.isNotEmpty) {
            thumbnail = item.thumbnails.last.url.toString();
          }

          allResults.add({
            'id': item.id.value,
            'title': item.title,
            'author': item.author,
            'duration': durationSecs,
            'thumbnail': thumbnail,
          });
        } catch (_) {}
      }
      return allResults;
    } catch (e) {
      print('[search] Error en YouTube para "$query": ${e.toString().split("\n").first}');
      return [];
    }
  }

  Future<Response> _search(Request req) async {
    final query = req.url.queryParameters['q'];
    if (query == null || query.isEmpty) {
      return Response(400, body: 'Falta el parámetro q');
    }

    // 🔄 Purgar entradas expiradas periódicamente
    if (_audioUrlCache.length > 80) {
      _purgeExpiredCache();
    }

    try {
      // Start both fetches immediately to reduce total latency.
      // If videos are slow, return stale cache (if any) and refresh in background.
      final videosFuture = _cachedYtSearch(query)
          .timeout(const Duration(milliseconds: 4200));

      final albumsFuture = () async {
        try {
          final plResults = await yt.search.searchContent(
            query,
            filter: TypeFilters.playlist,
          ).timeout(const Duration(milliseconds: 2800));
          final albums = <Map<String, dynamic>>[];
          for (final item in plResults.whereType<SearchPlaylist>()) {
            String thumb = '';
            if (item.thumbnails.isNotEmpty) {
              thumb = item.thumbnails.last.url.toString();
            }
            albums.add({
              'id': item.id.value,
              'title': item.title,
              'videoCount': item.videoCount,
              'thumbnail': thumb,
            });
            if (albums.length >= 6) break;
          }
          return albums;
        } catch (_) {
          return <Map<String, dynamic>>[];
        }
      }();

      List<Map<String, dynamic>> allResults;
      try {
        allResults = await videosFuture;
      } on TimeoutException {
        allResults = _getCachedSearch(query);
        if (allResults.isNotEmpty) {
          _refreshSearchInBackground(query);
        }
      }

      // Filtrar y categorizar canciones
      final canciones = allResults
          .where((song) =>
              (song['duration'] as int) >= 50 &&
              (song['duration'] as int) <= 600)
          .take(10)
          .toList();

      final podcasts = allResults
          .where((song) => (song['duration'] as int) > 600)
          .take(10)
          .toList();

      final albums = await albumsFuture;

      // Fast-fail fallback: if everything came empty but we have any cache, reuse it.
      if (canciones.isEmpty && podcasts.isEmpty && albums.isEmpty) {
        final cachedAny = _getCachedSearch(query);
        if (cachedAny.isNotEmpty) {
          final cachedSongs = cachedAny
              .where((song) =>
                  (song['duration'] as int) >= 50 &&
                  (song['duration'] as int) <= 600)
              .take(10)
              .toList();
          final cachedPodcasts = cachedAny
              .where((song) => (song['duration'] as int) > 600)
              .take(10)
              .toList();
          return _cors(Response.ok(
            jsonEncode({
              'Canciones': cachedSongs,
              'Podcasts o Recopilaciones': cachedPodcasts,
              'Albums': const <Map<String, dynamic>>[],
            }),
            headers: {'Content-Type': 'application/json'},
          ));
        }
      }

      final categorizedResults = {
        'Canciones': canciones,
        'Podcasts o Recopilaciones': podcasts,
        'Albums': albums,
      };

      // 🚀 Responder inmediatamente
      final response = _cors(Response.ok(
        jsonEncode(categorizedResults),
        headers: {'Content-Type': 'application/json'},
      ));

      // ⚡ Precargar URLs de audio en background
      if (canciones.isNotEmpty) {
        final ids = canciones.map((s) => s['id'] as String).toList();
        prefetchAudioUrls(ids);
      }

      return response;
    } catch (e, stack) {
      print('Error en búsqueda ($query): $e');
      print(stack);
      return _cors(Response.internalServerError(
          body: jsonEncode({'error': 'Error en búsqueda: $e'})));
    }
  }

  // Ruta de artista
  Future<Response> _artist(Request req) async {
    final artistName = req.url.queryParameters['name'];
    if (artistName == null || artistName.isEmpty) {
      return Response(400, body: 'Falta el parámetro name');
    }

    // Reintentos para el caso de errores transitorios de la API de YouTube
    const maxRetries = 2;
    for (int attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        final searchQuery = '$artistName music';
        final results = await yt.search.search(searchQuery);
        // Iterar manualmente para capturar errores por elemento
        // (algunos resultados tienen channelId vacío que lanza InvalidArgument)
        final validResults = <Video>[];
        for (final result in results) {
          try {
            if (result is Video && result.title.isNotEmpty && result.duration != null) {
              validResults.add(result);
            }
          } catch (_) {
            // Ignorar resultados con datos inválidos (ej: channelId vacío)
          }
        }

        final artistLower = artistName.toLowerCase();
        final artistSongs = validResults
            .where((video) {
              final authorLower = (video.author ?? '').toLowerCase();
              return authorLower.contains(artistLower) || artistLower.contains(authorLower);
            })
            .where((video) => video.duration != null)
            .where((video) =>
                (video.duration!.inSeconds) >= 120 &&
                (video.duration!.inSeconds) <= 600)
            .take(20)
            .map((v) => {
                  'id': v.id.value ?? '',
                  'title': v.title ?? '',
                  'author': v.author ?? '',
                  'duration': v.duration?.inSeconds ?? 0,
                  'thumbnail': v.thumbnails.highResUrl ?? v.thumbnails.standardResUrl ?? v.thumbnails.mediumResUrl ?? v.thumbnails.lowResUrl ?? '',
                  'uploadDate': v.uploadDate?.toIso8601String() ?? '',
                  'viewCount': v.engagement?.viewCount ?? 0,
                })
            .toList();

        final topSongs = artistSongs.take(15).toList();

        final artistData = {
          'artist': artistName,
          'totalSongs': topSongs.length,
          'songs': topSongs,
        };

        return _cors(Response.ok(jsonEncode(artistData), headers: {'Content-Type': 'application/json'}));
      } catch (e, stack) {
        print('Error obteniendo artista "$artistName" (intento ${attempt + 1}/${ maxRetries + 1}): $e');
        if (attempt < maxRetries) {
          // Espera corta antes de reintentar (500ms)
          await Future.delayed(const Duration(milliseconds: 500));
          continue;
        }
        print(stack);
        return _cors(Response.internalServerError(
            body: jsonEncode({'error': 'Error obteniendo información del artista: $e'})));
      }
    }
    // Nunca llega aquí, pero Dart requiere un return
    return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error inesperado'})));
  }

  int _estimateMonthlyListeners(int? subscribers, int topViews, int songsCount) {
    if (subscribers != null && subscribers > 0) {
      return subscribers;
    }
    final safeSongs = songsCount <= 0 ? 1 : songsCount;
    final avgViews = (topViews / safeSongs).round();
    final estimated = (avgViews * 0.22).round();
    return estimated < 8000 ? 8000 : estimated;
  }

  List<String> _extractFeaturingArtists(String rawTitle) {
    final title = rawTitle;
    final featuring = <String>[];
    final patterns = [
      RegExp(r'(?:feat\.?|ft\.?|featuring)\s+([^\]\)\-|,]+)', caseSensitive: false),
      RegExp(r'\bx\s+([^\]\)\-|,]+)', caseSensitive: false),
      RegExp(r'\bwith\s+([^\]\)\-|,]+)', caseSensitive: false),
    ];

    for (final rx in patterns) {
      for (final m in rx.allMatches(title)) {
        final name = (m.group(1) ?? '').trim();
        if (name.isNotEmpty && !featuring.contains(name)) {
          featuring.add(name);
        }
      }
    }
    return featuring;
  }

  String? _extractProducer(String text) {
    final regs = [
      RegExp(r'prod\.?\s*by\s*([^\n\|,;]+)', caseSensitive: false),
      RegExp(r'producer\s*[:\-]\s*([^\n\|,;]+)', caseSensitive: false),
      RegExp(r'produced\s*by\s*([^\n\|,;]+)', caseSensitive: false),
    ];
    for (final rx in regs) {
      final m = rx.firstMatch(text);
      if (m != null) {
        final producer = (m.group(1) ?? '').trim();
        if (producer.isNotEmpty) return producer;
      }
    }
    return null;
  }

  String? _extractLabel(String text) {
    final regs = [
      RegExp(r'(?:℗|©)\s*\d{4}\s*([^\n\.;\|]+)', caseSensitive: false),
      RegExp(r'label\s*[:\-]\s*([^\n\.;\|]+)', caseSensitive: false),
      RegExp(r'(?:licensed|license)\s+to\s+([^\n\.;\|]+)', caseSensitive: false),
    ];
    for (final rx in regs) {
      final m = rx.firstMatch(text);
      if (m != null) {
        final label = (m.group(1) ?? '').trim();
        if (label.isNotEmpty) return label;
      }
    }
    return null;
  }

  int? _extractReleaseYear(Video? video, String text) {
    if (video?.publishDate != null) return video!.publishDate!.year;
    if (video?.uploadDate != null) return video!.uploadDate!.year;
    final m = RegExp(r'\b(19|20)\d{2}\b').firstMatch(text);
    if (m == null) return null;
    return int.tryParse(m.group(0)!);
  }

  Future<Response> _songInsights(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final songId = req.url.queryParameters['id']?.trim() ?? '';
      final artistName = req.url.queryParameters['artist']?.trim() ?? '';
      final songTitle = req.url.queryParameters['title']?.trim() ?? '';

      if (songId.isEmpty) {
        return _cors(Response.badRequest(
          body: jsonEncode({'error': 'Falta el parámetro id'}),
        ));
      }

      final db = DatabaseHelper();
      final inPlaylists = await db.getPlaylistsContainingSong(user['id'] as int, songId);

      Video? video;
      try {
        video = await yt.videos.get(songId).timeout(const Duration(seconds: 10));
      } catch (_) {}

      String resolvedArtist = artistName.isNotEmpty
          ? artistName
          : (video?.author ?? 'Artista desconocido');

      final videoTitle = video?.title ?? songTitle;
      final featuring = _extractFeaturingArtists(videoTitle);
      final releaseYear = _extractReleaseYear(video, video?.description ?? '');

      return _cors(Response.ok(
        jsonEncode({
          'artist': {'name': resolvedArtist},
          'song': {
            'id': songId,
            'views': video?.engagement.viewCount ?? 0,
            'year': releaseYear,
          },
          'playlists': {
            'count': inPlaylists.length,
            'names': inPlaylists.map((p) => p['name']).whereType<String>().toList(),
          },
          'credits': {
            'featuring': featuring,
            'release_year': releaseYear,
          },
        }),
        headers: {'Content-Type': 'application/json'},
      ));
    } catch (e) {
      print('Error en song-insights: $e');
      return _cors(Response.internalServerError(
        body: jsonEncode({'error': 'Error interno del servidor'}),
      ));
    }
  }

  // 🎵 Ruta de audio con streaming progresivo
  // Ruta para obtener letras de canciones
  Future<Response> _lyrics(Request req) async {
    final id = req.url.queryParameters['id'];
    if (id == null || id.isEmpty) {
      return _cors(Response.badRequest(body: jsonEncode({'error': 'Falta el ID de la canción'})));
    }
    final rawArtist = req.url.queryParameters['artist'] ?? '';
    final rawTitle  = req.url.queryParameters['title']  ?? '';

    // Clean title: strip noise like "(Official Video)", "[Lyrics]", "- Official Audio", etc.
    String _cleanTitle(String t) => t
        .replaceAll(RegExp(r'\((?:official|video|audio|lyrics?|lyric|hd|4k|clip|music|ft\.?|feat\.?)[^)]*\)', caseSensitive: false), '')
        .replaceAll(RegExp(r'\[(?:official|video|audio|lyrics?|lyric|hd)[^\]]*\]', caseSensitive: false), '')
        .replaceAll(RegExp(r'\s*[-–]\s*(official|video|audio|lyric|lyrics|visualizer|clip|hd|4k).*$', caseSensitive: false), '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();

    final artist     = rawArtist.trim();
    // Limpiar el título: quitar ruido de YouTube y el prefijo "Artista - " si está presente
    final titleCleaned = _cleanTitle(rawTitle);
    // Si el título empieza por "Artista - Cancion", quitar el prefijo "Artista - "
    final artistPrefix = artist.isNotEmpty
        ? RegExp('^${RegExp.escape(artist)}\\s*[-–]\\s*', caseSensitive: false)
        : null;
    final title = (artistPrefix != null && artistPrefix.hasMatch(titleCleaned))
        ? titleCleaned.replaceFirst(artistPrefix, '').trim()
        : titleCleaned;

    // ── 1. Try LRCLIB (synced > plain) ──────────────────────────────────────
    if (artist.isNotEmpty || title.isNotEmpty) {
      try {
        final lrclibRes = await _fetchLrcLib(artist, title);
        if (lrclibRes != null) return lrclibRes;
      } catch (e) {
        print('[lyrics] LRCLIB error: $e');
      }
    }

    // ── 2. Fallback: YouTube description ────────────────────────────────────
    try {
      final video = await yt.videos.get(id).timeout(const Duration(seconds: 10));
      final description = video.description;
      if (description.toLowerCase().contains('lyrics') ||
          description.toLowerCase().contains('letra')) {
        final lines = description.split('\n');
        final lyricsLines = <Map<String, dynamic>>[];
        bool inLyrics = false;
        int currentTime = 0;
        for (var line in lines) {
          if (line.toLowerCase().contains('lyrics') || line.toLowerCase().contains('letra')) {
            inLyrics = true; continue;
          }
          if (inLyrics && line.trim().isNotEmpty) {
            if (line.contains('http') || line.startsWith('#') ||
                line.contains('©') || line.toLowerCase().contains('subscribe') ||
                line.toLowerCase().contains('follow')) break;
            final timeRegex = RegExp(r'^\[(\d+):(\d+(?:\.\d+)?)\]');
            final m = timeRegex.firstMatch(line);
            String cleanLine = line;
            int timestamp = currentTime;
            if (m != null) {
              timestamp = int.parse(m.group(1)!) * 60 + double.parse(m.group(2)!).round();
              cleanLine = line.substring(m.end).trim();
            } else {
              currentTime += 20;
              timestamp = currentTime;
            }
            if (cleanLine.isNotEmpty) lyricsLines.add({'time': timestamp, 'text': cleanLine});
          }
        }
        if (lyricsLines.isNotEmpty) {
          lyricsLines.sort((a, b) => (a['time'] as int).compareTo(b['time'] as int));
          return _cors(Response.ok(
            jsonEncode({'lyrics': jsonEncode(lyricsLines), 'source': 'youtube-description'}),
            headers: {'Content-Type': 'application/json'},
          ));
        }
      }
    } catch (e) {
      print('[lyrics] YT description fallback error: $e');
    }

    return _cors(Response.ok(
      jsonEncode({'lyrics': null, 'message': 'No se encontraron letras'}),
      headers: {'Content-Type': 'application/json'},
    ));
  }

  /// Queries LRCLIB and returns a shelf Response if lyrics are found, null otherwise.
  Future<Response?> _fetchLrcLib(String artist, String title) async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 6);
    try {
      // Exact match first
      final uri = Uri.https('lrclib.net', '/api/get', {
        if (artist.isNotEmpty) 'artist_name': artist,
        if (title.isNotEmpty)  'track_name':  title,
      });
      final req1 = await client.getUrl(uri);
      req1.headers.set('User-Agent', 'Esplotify/1.0');
      final res1 = await req1.close().timeout(const Duration(seconds: 8));

      final data1 = await _readLrcLibResponse(res1);
      if (data1 != null) {
        final r = _lrclibDataToResponse(data1);
        if (r != null) return r;
      }

      // Fuzzy search fallback
      final uri2 = Uri.https('lrclib.net', '/api/search', {'q': '$artist $title'.trim()});
      final req2 = await client.getUrl(uri2);
      req2.headers.set('User-Agent', 'Esplotify/1.0');
      final res2 = await req2.close().timeout(const Duration(seconds: 8));
      if (res2.statusCode == 200) {
        final body2 = await res2.transform(utf8.decoder).join();
        final results = jsonDecode(body2);
        if (results is List && results.isNotEmpty) {
          final r = _lrclibDataToResponse(results.first as Map<String, dynamic>);
          if (r != null) return r;
        }
      }
    } finally {
      client.close();
    }
    return null;
  }

  Future<Map<String, dynamic>?> _readLrcLibResponse(HttpClientResponse res) async {
    if (res.statusCode != 200) return null;
    final body = await res.transform(utf8.decoder).join();
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) return decoded;
    return null;
  }

  Response? _lrclibDataToResponse(Map<String, dynamic> data) {
    final synced = data['syncedLyrics'] as String?;
    final plain  = data['plainLyrics']  as String?;

    if (synced != null && synced.trim().isNotEmpty) {
      final lines = _parseLrc(synced);
      if (lines.isNotEmpty) {
        return _cors(Response.ok(
          jsonEncode({'lyrics': jsonEncode(lines), 'source': 'lrclib-synced'}),
          headers: {'Content-Type': 'application/json'},
        ));
      }
    }
    if (plain != null && plain.trim().isNotEmpty) {
      // Return lines without timestamps; client distributes them based on song duration
      final lines = plain.split('\n')
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty)
          .map((l) => {'text': l})
          .toList();
      return _cors(Response.ok(
        jsonEncode({'lyrics': jsonEncode(lines), 'plainText': true, 'source': 'lrclib-plain'}),
        headers: {'Content-Type': 'application/json'},
      ));
    }
    return null;
  }

  /// Parse LRC format: `[mm:ss.xx] text` → list of {time, text}
  List<Map<String, dynamic>> _parseLrc(String lrc) {
    final lineRe = RegExp(r'^\[(\d{2}):(\d{2})(?:\.\d+)?\]\s*(.*)$');
    final out = <Map<String, dynamic>>[];
    for (final raw in lrc.split('\n')) {
      final m = lineRe.firstMatch(raw.trim());
      if (m == null) continue;
      final text = m.group(3)!.trim();
      if (text.isEmpty) continue;
      out.add({'time': int.parse(m.group(1)!) * 60 + int.parse(m.group(2)!), 'text': text});
    }
    return out;
  }

  /// Assign fake timestamps to plain lyrics (5 s apart).
  Future<Response> _audio(Request req) async {
    final id = req.url.queryParameters['id'];
    if (id == null || id.isEmpty) {
      return Response(400, body: 'Falta el parámetro id');
    }
    try {
      final audioUrl = await getAudioUrl(id);
      return Response(302, headers: {
        'Location': audioUrl,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, Content-Type, Range, Authorization',
      });
    } catch (e) {
      print('[audio] Error para $id: $e');
      _removeCacheEntry(id);
      return _cors(Response.internalServerError(body: 'Error obteniendo audio'));
    }
  }

  // Middleware de autenticación
  Middleware authMiddleware() {
    return (Handler innerHandler) {
      return (Request request) async {
        try {
          final authHeader = request.headers['authorization'];
          if (authHeader != null && authHeader.startsWith('Bearer ')) {
            final token = authHeader.substring(7);
            final user = await AuthService.getUserFromToken(token);
            if (user != null) {
              return innerHandler(request.change(context: {'user': user}));
            }
          }
        } catch (e) {
          print('Error validando token: $e');
        }
        return _cors(Response.forbidden(jsonEncode({'error': 'Token inválido o expirado'})));
      };
    };
  }

  // Ruta de registro
  Future<Response> _register(Request req) async {
    try {
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final username = data['username']?.toString();
      final email = data['email']?.toString();
      final password = data['password']?.toString();
      final day = data['day']?.toString();
      final month = data['month']?.toString();
      final year = data['year']?.toString();
      final gender = data['gender']?.toString();
      final marketing = data['marketing'] == true;
      final terms = data['terms'] == true;

      if (username == null || email == null || password == null ||
          username.isEmpty || email.isEmpty || password.isEmpty) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Todos los campos son requeridos'})));
      }

      if (password.length < 6) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'La contraseña debe tener al menos 6 caracteres'})));
      }

      if (!terms) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Debes aceptar los términos y condiciones'})));
      }

      final db = DatabaseHelper();

      // Verificar si el usuario ya existe
      if (await db.userExists(username, email)) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'El usuario o email ya existe'})));
      }

      // Construir fecha de nacimiento
      String? birthdate;
      if (day != null && month != null && year != null &&
          day.isNotEmpty && month.isNotEmpty && year.isNotEmpty) {
        birthdate = '$year-$month-$day';
      }

      // Crear nuevo usuario
      final hashedPassword = db.hashPassword(password);
      final user = User(
        username: username,
        email: email,
        passwordHash: hashedPassword,
        birthdate: birthdate,
        gender: gender,
        marketing: marketing,
        terms: terms,
      );

      final userId = await db.insertUser(user);

      // Generar token
      final userWithId = User(
        id: userId,
        username: username,
        email: email,
        passwordHash: hashedPassword,
        birthdate: birthdate,
        gender: gender,
        marketing: marketing,
        terms: terms,
      );

      final token = AuthService.generateToken(userWithId);

      return _cors(Response.ok(jsonEncode({
        'message': 'Usuario registrado exitosamente',
        'token': token,
        'user': {
          'id': userId,
          'username': username,
          'email': email,
          'birthdate': birthdate,
          'gender': gender,
          'marketing': marketing,
          'terms': terms,
        }
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e, st) {
      _log('Error en registro: $e\n$st');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno: $e'}), headers: {'Content-Type': 'application/json'}));
    }
  }

  // Ruta de login
  Future<Response> _login(Request req) async {
    try {
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final username = data['username']?.toString();
      final password = data['password']?.toString();

      if (username == null || password == null ||
          username.isEmpty || password.isEmpty) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Usuario y contraseña son requeridos'})));
      }

      final db = DatabaseHelper();
      final user = await db.getUserByUsername(username);

      if (user == null || !db.verifyPassword(password, user.passwordHash)) {
        return _cors(Response.unauthorized(jsonEncode({'error': 'Credenciales inválidas'})));
      }

      final token = AuthService.generateToken(user);

      return _cors(Response.ok(jsonEncode({
        'message': 'Login exitoso',
        'token': token,
        'user': {
          'id': user.id,
          'username': user.username,
          'email': user.email,
        }
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e, st) {
      _log('Error en login: $e\n$st');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno: $e'}), headers: {'Content-Type': 'application/json'}));
    }
  }

  // Ruta para verificar token (opcional)
  Future<Response> _verifyToken(Request req) async {
    final user = req.context['user'] as Map<String, dynamic>;
    return _cors(Response.ok(jsonEncode({
      'valid': true,
      'user': user
    }), headers: {'Content-Type': 'application/json'}));
  }

  // Ruta para crear playlist
  Future<Response> _createPlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final name = data['name']?.toString();
      if (name == null || name.isEmpty) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Nombre de playlist requerido'})));
      }

      final db = DatabaseHelper();
      final playlistId = await db.createPlaylist(user['id'], name);

      return _cors(Response.ok(jsonEncode({
        'success': true,
        'message': 'Playlist creada exitosamente',
        'playlist': {
          'id': playlistId,
          'name': name,
          'created_at': DateTime.now().toIso8601String(),
        }
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error creando playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para obtener playlists del usuario
  Future<Response> _getUserPlaylists(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final db = DatabaseHelper();
      final playlists = await db.getUserPlaylists(user['id']);

      return _cors(Response.ok(jsonEncode({
        'playlists': playlists
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error obteniendo playlists: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para añadir canción a playlist
  Future<Response> _addSongToPlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final playlistId = data['playlist_id'] is int ? data['playlist_id'] : int.tryParse(data['playlist_id']?.toString() ?? '');
      final song = data['song'];

      if (playlistId == null || song == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Playlist ID y canción requeridos'})));
      }

      final db = DatabaseHelper();

      // Verificar que la playlist pertenece al usuario
      final playlists = await db.getUserPlaylists(user['id']);
      final playlist = playlists.firstWhere(
        (p) => p['id'] == playlistId,
        orElse: () => <String, dynamic>{},
      );

      if (playlist.isEmpty) {
        return _cors(Response.forbidden(jsonEncode({'error': 'Playlist no encontrada o no autorizada'})));
      }

      // Verificar si la canción ya está en la playlist
      final isInPlaylist = await db.isSongInPlaylist(playlistId, song['id']);
      if (isInPlaylist) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'La canción ya está en la playlist'})));
      }

      await db.addSongToPlaylist(playlistId, song as Map<String, dynamic>);

      return _cors(Response.ok(jsonEncode({
        'message': 'Canción añadida a la playlist exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error añadiendo canción a playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para obtener canciones de una playlist
  Future<Response> _getPlaylistSongs(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final playlistId = int.tryParse(req.url.queryParameters['playlist_id'] ?? '');

      if (playlistId == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Playlist ID requerido'})));
      }

      final db = DatabaseHelper();

      // Verificar que la playlist pertenece al usuario
      final playlists = await db.getUserPlaylists(user['id']);
      final playlist = playlists.firstWhere(
        (p) => p['id'] == playlistId,
        orElse: () => <String, dynamic>{},
      );

      if (playlist.isEmpty) {
        return _cors(Response.forbidden(jsonEncode({'error': 'Playlist no encontrada o no autorizada'})));
      }

      final songs = await db.getPlaylistSongs(playlistId);

      final mappedSongs = songs.map((song) => {
        'id': song['song_id'],
        'title': song['song_title'],
        'author': song['song_author'],
        'duration': song['song_duration'],
        'thumbnail': song['song_thumbnail'],
      }).toList();

      return _cors(Response.ok(jsonEncode({
        'playlist': playlist,
        'songs': mappedSongs
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error obteniendo canciones de playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para eliminar playlist
  Future<Response> _deletePlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final playlistId = int.tryParse(data['playlist_id']?.toString() ?? '');
      if (playlistId == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Playlist ID requerido'})));
      }

      final db = DatabaseHelper();
      final deleted = await db.deletePlaylist(playlistId, user['id']);

      if (deleted == 0) {
        return _cors(Response.notFound(jsonEncode({'error': 'Playlist no encontrada'})));
      }

      return _cors(Response.ok(jsonEncode({
        'success': true,
        'message': 'Playlist eliminada exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error eliminando playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para remover canción de playlist
  Future<Response> _removeSongFromPlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final playlistId = data['playlist_id'] is int ? data['playlist_id'] : int.tryParse(data['playlist_id']?.toString() ?? '');
      final songId = data['song_id'];

      if (playlistId == null || songId == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Playlist ID y Song ID requeridos'})));
      }

      final db = DatabaseHelper();

      // Verificar que la playlist pertenece al usuario
      final playlists = await db.getUserPlaylists(user['id']);
      final playlist = playlists.firstWhere(
        (p) => p['id'] == playlistId,
        orElse: () => <String, dynamic>{},
      );

      if (playlist.isEmpty) {
        return _cors(Response.forbidden(jsonEncode({'error': 'Playlist no encontrada o no autorizada'})));
      }

      await db.removeSongFromPlaylist(playlistId, songId);

      return _cors(Response.ok(jsonEncode({
        'message': 'Canción removida de la playlist exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error removiendo canción de playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para reemplazar todas las canciones de una playlist
  Future<Response> _replacePlaylistSongs(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final playlistId = data['playlist_id'] is int ? data['playlist_id'] : int.tryParse(data['playlist_id']?.toString() ?? '');
      final songs = data['songs'] as List<dynamic>?;

      if (playlistId == null || songs == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Playlist ID y songs requeridos'})));
      }

      final db = DatabaseHelper();

      // Verificar que la playlist pertenece al usuario
      final playlists = await db.getUserPlaylists(user['id']);
      final playlist = playlists.firstWhere(
        (p) => p['id'] == playlistId,
        orElse: () => <String, dynamic>{},
      );

      if (playlist.isEmpty) {
        return _cors(Response.forbidden(jsonEncode({'error': 'Playlist no encontrada o no autorizada'})));
      }

      // Eliminar todas las canciones actuales de la playlist
      await db.clearPlaylistSongs(playlistId);

      // Agregar las nuevas canciones
      for (final song in songs) {
        await db.addSongToPlaylist(playlistId, song as Map<String, dynamic>);
      }

      return _cors(Response.ok(jsonEncode({
        'message': 'Canciones de la playlist reemplazadas exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error reemplazando canciones de playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }



  // Ruta para obtener recently played
  Future<Response> _getRecentlyPlayed(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final db = DatabaseHelper();
      final recentlyPlayed = await db.getRecentlyPlayed(user['id']);

      // Mapear DB rows a formato que espera el frontend
      final mapped = recentlyPlayed.map((r) {
        String rawThumb = (r['song_thumbnail'] ?? '').toString();
        rawThumb = rawThumb.trim();
        if (rawThumb.toLowerCase() == 'undefined' || rawThumb.toLowerCase() == 'null') {
          rawThumb = '';
        }
        return {
          'id': r['song_id'] ?? '',
          'title': r['song_title'] ?? '',
          'author': r['song_author'] ?? '',
          'duration': r['song_duration'] ?? 0,
          'thumbnail': rawThumb,
          'played_at': r['played_at'] ?? ''
        };
      }).toList();

      return _cors(Response.ok(jsonEncode({
        'recently_played': mapped
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error obteniendo recently played: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para añadir a recently played
  Future<Response> _addRecentlyPlayed(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final song = data['song'];
      if (song == null || song['id'] == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Canción requerida'})));
      }

      final db = DatabaseHelper();
      await db.addRecentlyPlayed(user['id'], song as Map<String, dynamic>);

      return _cors(Response.ok(jsonEncode({
        'message': 'Canción añadida a recently played'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error añadiendo a recently played: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para obtener auto-generated playlists
  Future<Response> _getAutoGeneratedPlaylists(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final db = DatabaseHelper();
      final autoPlaylists = await db.getAutoGeneratedPlaylists(user['id']);

      return _cors(Response.ok(jsonEncode({
        'auto_playlists': autoPlaylists
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error obteniendo auto-generated playlists: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para crear auto-generated playlist
  Future<Response> _createAutoGeneratedPlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final id = data['id'];
      final name = data['name'];
      final description = data['description'];
      final songs = data['songs'];
      final owner = data['owner'];

      if (id == null || name == null || songs == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'ID, nombre y canciones requeridos'})));
      }

      final db = DatabaseHelper();
      final List<Map<String, dynamic>> castedSongs = (songs as List<dynamic>)
          .map((s) => s as Map<String, dynamic>)
          .toList();
      await db.createAutoGeneratedPlaylist(user['id'], id, name, description ?? '', castedSongs, owner ?? 'Esplotify');

      return _cors(Response.ok(jsonEncode({
        'message': 'Auto-generated playlist creada exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error creando auto-generated playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para actualizar auto-generated playlist
  Future<Response> _updateAutoGeneratedPlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final id = data['id'];
      final songs = data['songs'];

      if (id == null || songs == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'ID y canciones requeridos'})));
      }

      final db = DatabaseHelper();
      final List<Map<String, dynamic>> castedSongs = (songs as List<dynamic>)
          .map((s) => s as Map<String, dynamic>)
          .toList();
      await db.updateAutoGeneratedPlaylist(id, user['id'], castedSongs);

      return _cors(Response.ok(jsonEncode({
        'message': 'Auto-generated playlist actualizada exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error actualizando auto-generated playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para eliminar auto-generated playlist
  Future<Response> _deleteAutoGeneratedPlaylist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final id = data['id'];
      if (id == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'ID requerido'})));
      }

      final db = DatabaseHelper();
      await db.deleteAutoGeneratedPlaylist(id, user['id']);

      return _cors(Response.ok(jsonEncode({
        'message': 'Auto-generated playlist eliminada exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error eliminando auto-generated playlist: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para añadir canción a liked songs
  Future<Response> _addLikedSong(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final song = data['song'];
      if (song == null || song['id'] == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Canción requerida'})));
      }

      final db = DatabaseHelper();
      await db.addLikedSong(user['id'], song as Map<String, dynamic>);

      return _cors(Response.ok(jsonEncode({
        'message': 'Canción añadida a liked songs exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error añadiendo canción a liked songs: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para remover canción de liked songs
  Future<Response> _removeLikedSong(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final songId = data['song_id'];
      if (songId == null) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Song ID requerido'})));
      }

      final db = DatabaseHelper();
      await db.removeLikedSong(user['id'], songId);

      return _cors(Response.ok(jsonEncode({
        'message': 'Canción removida de liked songs exitosamente'
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error removiendo canción de liked songs: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para obtener liked songs
  Future<Response> _getLikedSongs(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final db = DatabaseHelper();
      final likedSongs = await db.getLikedSongs(user['id']);

      return _cors(Response.ok(jsonEncode({
        'liked_songs': likedSongs
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error obteniendo liked songs: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para verificar si una canción está liked
  Future<Response> _isSongLiked(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final songId = req.url.queryParameters['song_id'];

      if (songId == null || songId.isEmpty) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Song ID requerido'})));
      }

      final db = DatabaseHelper();
      final isLiked = await db.isSongLiked(user['id'], songId);

      return _cors(Response.ok(jsonEncode({
        'is_liked': isLiked
      }), headers: {'Content-Type': 'application/json'}));

    } catch (e) {
      print('Error verificando si canción está liked: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para seguir/dejar de seguir artista
  Future<Response> _followArtist(Request req) async {
    try {
      final user = req.context['user'] as Map<String, dynamic>;
      final body = await req.readAsString();
      final data = jsonDecode(body);

      final artistName = data['artist']?.toString();
      if (artistName == null || artistName.isEmpty) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'Nombre de artista requerido'})));
      }

      final db = DatabaseHelper();
      final isFollowed = await db.isArtistFollowed(user['id'], artistName);

      if (isFollowed) {
        await db.unfollowArtist(user['id'], artistName);
        return _cors(Response.ok(jsonEncode({
          'success': true,
          'following': false,
          'message': 'Has dejado de seguir a $artistName'
        }), headers: {'Content-Type': 'application/json'}));
      } else {
        await db.followArtist(user['id'], artistName);
        return _cors(Response.ok(jsonEncode({
          'success': true,
          'following': true,
          'message': 'Ahora sigues a $artistName'
        }), headers: {'Content-Type': 'application/json'}));
      }
    } catch (e) {
      print('Error siguiendo artista: $e');
      return _cors(Response.internalServerError(body: jsonEncode({'error': 'Error interno del servidor'})));
    }
  }

  // Ruta para obtener las canciones de un álbum (playlist de YouTube)
  Future<Response> _album(Request req) async {
    final playlistId = req.url.queryParameters['id'];
    if (playlistId == null || playlistId.isEmpty) {
      return _cors(Response.badRequest(body: jsonEncode({'error': 'Falta el parámetro id'})));
    }
    try {
      final playlist = await yt.playlists.get(playlistId).timeout(Duration(seconds: 12));
      final thumbnail = playlist.thumbnails.highResUrl.isNotEmpty
          ? playlist.thumbnails.highResUrl
          : playlist.thumbnails.standardResUrl.isNotEmpty
              ? playlist.thumbnails.standardResUrl
              : playlist.thumbnails.mediumResUrl;

      final tracks = <Map<String, dynamic>>[];
      await for (final video in yt.playlists.getVideos(playlistId).timeout(Duration(seconds: 30))) {
        if (video.duration == null) continue;
        final dur = video.duration!.inSeconds;
        if (dur < 30 || dur > 900) continue;
        tracks.add({
          'id': video.id.value,
          'title': video.title,
          'author': video.author,
          'duration': dur,
          'thumbnail': video.thumbnails.highResUrl.isNotEmpty
              ? video.thumbnails.highResUrl
              : video.thumbnails.mediumResUrl,
        });
        if (tracks.length >= 50) break;
      }

      return _cors(Response.ok(jsonEncode({
        'id': playlistId,
        'title': playlist.title,
        'author': playlist.author,
        'thumbnail': thumbnail,
        'trackCount': tracks.length,
        'tracks': tracks,
      }), headers: {'Content-Type': 'application/json'}));
    } catch (e) {
      print('[album] Error para $playlistId: $e');
      return _cors(Response.internalServerError(
          body: jsonEncode({'error': 'Error obteniendo álbum: $e'})));
    }
  }

  // Endpoint de prefetch: el frontend lo llama cuando muestra una lista de canciones
  // para calentar el cache antes de que el usuario haga clic en reproducir.
  Future<Response> _prefetch(Request req) async {
    try {
      final body = await req.readAsString();
      final data = jsonDecode(body);
      final ids = (data['ids'] as List?)?.map((e) => e.toString()).toList() ?? [];
      if (ids.isEmpty) {
        return _cors(Response.badRequest(body: jsonEncode({'error': 'ids requerido'})));
      }
      // Lanzar prefetch en background y responder inmediatamente
      prefetchAudioUrls(ids.take(5).toList());
      return _cors(Response.ok(
        jsonEncode({'status': 'prefetching', 'count': ids.length}),
        headers: {'Content-Type': 'application/json'},
      ));
    } catch (e) {
      return _cors(Response.internalServerError(body: 'Error en prefetch'));
    }
  }

  void main(List<String> args) async {
    _initLog();
    _log('Servidor iniciando...');
    _log('Exe: ${Platform.resolvedExecutable}');
    _log('ESPLOTIFY_DATA_DIR: ${Platform.environment['ESPLOTIFY_DATA_DIR'] ?? '(no definido)'}');

    final router = Router()
      ..get('/search', _search)
      ..get('/artist', _artist)
      ..get('/album', _album)
      ..get('/audio', _audio)
      ..get('/lyrics', _lyrics)
      ..get('/song-insights', authMiddleware()(_songInsights))
      ..post('/register', _register)
      ..post('/login', _login)
      ..get('/verify-token', authMiddleware()(_verifyToken))
      ..post('/create-playlist', authMiddleware()(_createPlaylist))
      ..get('/user-playlists', authMiddleware()(_getUserPlaylists))
      ..post('/add-to-playlist', authMiddleware()(_addSongToPlaylist))
      ..get('/playlist-songs', authMiddleware()(_getPlaylistSongs))
      ..delete('/delete-playlist', authMiddleware()(_deletePlaylist))
      ..delete('/remove-from-playlist', authMiddleware()(_removeSongFromPlaylist))
      ..put('/replace-playlist-songs', authMiddleware()(_replacePlaylistSongs))
      ..get('/recently-played', authMiddleware()(_getRecentlyPlayed))
      ..post('/add-recently-played', authMiddleware()(_addRecentlyPlayed))
      ..get('/auto-generated-playlists', authMiddleware()(_getAutoGeneratedPlaylists))
      ..post('/create-auto-generated-playlist', authMiddleware()(_createAutoGeneratedPlaylist))
      ..put('/update-auto-generated-playlist', authMiddleware()(_updateAutoGeneratedPlaylist))
      ..delete('/delete-auto-generated-playlist', authMiddleware()(_deleteAutoGeneratedPlaylist))
      ..post('/add-liked-song', authMiddleware()(_addLikedSong))
      ..delete('/remove-liked-song', authMiddleware()(_removeLikedSong))
      ..get('/liked-songs', authMiddleware()(_getLikedSongs))
      ..get('/is-song-liked', authMiddleware()(_isSongLiked))
      ..post('/follow-artist', authMiddleware()(_followArtist))
      ..post('/prefetch', _prefetch)
      ..options('/<ignored|.*>', _options);

    final staticHandler =
        createStaticHandler('web', defaultDocument: 'index.html');

    final handler = const Pipeline()
        .addMiddleware(logRequests())
        .addHandler((request) async {
      try {
        // 1. Intentar con el router (API)
        final response = await router(request);

        // 2. Si el router no encontró la ruta (404), intentar con el static handler
        if (response.statusCode == 404) {
          return staticHandler(request);
        }

        // 3. De lo contrario, devolver la respuesta del router
        return response;
      } catch (e, st) {
        print('Error no controlado en request ${request.method} ${request.requestedUri}: $e');
        print(st);
        return _cors(Response.internalServerError(
          body: jsonEncode({'error': 'Error interno del servidor'}),
          headers: {'Content-Type': 'application/json'},
        ));
      }
    });

    final port = int.parse(Platform.environment['PORT'] ?? '3000');
    final server = await shelf_io.serve(handler, InternetAddress.anyIPv4, port);
    print('✅ Servidor escuchando en http://localhost:${server.port}');
  }
