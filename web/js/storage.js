/**
 * ========================================
 * MÓDULO DE STORAGE - Almacenamiento Local
 * ========================================
 * Propósito: Gestiona localStorage para datos del usuario
 * 
 * Almacena:
 * - likedSongsPlaylist: Canciones favoritas (cache local)
 * - madeForYouPlaylists: Playlists automáticas generadas
 * - recentlyPlayed: Historial de reproducción
 */
(function () {
    function createStorageModule(config) {
        const {
            getLikedSongs,
        } = config;

        // Claves de localStorage
        const likedSongsPlaylistKey = 'likedSongsPlaylist';
        const madeForYouKey = 'madeForYouPlaylists';

        /**
         * Guarda las canciones favoritas en localStorage
         */
        function saveLikedSongs() {
            localStorage.setItem('likedSongs', JSON.stringify(getLikedSongs()));
        }

        /**
         * Obtiene la playlist de canciones favoritas desde localStorage
         * @returns {Array} Array de canciones favoritas
         */
        function getLikedSongsPlaylist() {
            try {
                const raw = localStorage.getItem(likedSongsPlaylistKey);
                return raw ? JSON.parse(raw) : [];
            } catch {
                return [];
            }
        }

        /**
         * Guarda la playlist de favoritos en localStorage
         * @param {Array} songs - Array de canciones favoritas
         */
        function saveLikedSongsPlaylist(songs) {
            localStorage.setItem(likedSongsPlaylistKey, JSON.stringify(songs));
        }

        /**
         * Guarda las playlists automáticas (Mix Diario, Descubrimiento, Novedades)
         * @param {Array} playlists - Array de playlists generadas
         */
        function saveMadeForYouPlaylists(playlists) {
            try {
                localStorage.setItem(madeForYouKey, JSON.stringify(playlists));
            } catch (e) {
                console.error('Error saving madeForYouPlaylists:', e);
            }
        }

        /**
         * Carga las playlists automáticas desde localStorage
         * Normaliza el formato de las canciones por compatibilidad
         * @returns {Array|null} Array de playlists o null si no existen
         */
        function loadMadeForYouPlaylists() {
            try {
                const raw = localStorage.getItem(madeForYouKey);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                // Normaliza el formato de canciones (compatibilidad con formatos antiguos)
                if (Array.isArray(parsed)) {
                    parsed.forEach(pl => {
                        if (Array.isArray(pl.songs)) {
                            pl.songs = pl.songs.map(s => ({
                                id: s.id ?? s.song_id ?? '',
                                title: s.title ?? s.song_title ?? 'Cancion desconocida',
                                author: s.author ?? s.song_author ?? 'Desconocido',
                                duration: s.duration ?? s.song_duration ?? 0,
                                thumbnail: (s.thumbnail ?? s.song_thumbnail ?? '') || '',
                            }));
                        }
                    });
                }
                return parsed;
            } catch (e) {
                console.error('Error loading madeForYouPlaylists:', e);
                return null;
            }
        }

        return {
            saveLikedSongs,
            getLikedSongsPlaylist,
            saveLikedSongsPlaylist,
            saveMadeForYouPlaylists,
            loadMadeForYouPlaylists,
            madeForYouKey,
        };
    }

    window.EsplotifyStorage = {
        createStorageModule,
    };
})();
