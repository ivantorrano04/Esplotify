/**
 * ========================================
 * MÓDULO DE API - Llamadas al Backend
 * ========================================
 * Propósito: Centraliza todas las peticiones HTTP al servidor
 * 
 * Endpoints:
 * - GET/POST/DELETE /liked-songs - Gestión de favoritos
 * - GET/POST /recently-played - Historial de reproducción
 * - GET/POST /auto-playlists - Playlists automáticas
 * 
 * Autenticación: Todas las peticiones incluyen Bearer token
 */
(function () {
    /**
     * Genera headers de autenticación para peticiones fetch
     * @param {string} token - Token JWT del usuario
     * @param {boolean} withJson - Si true, incluye Content-Type: application/json
     * @returns {Object} Headers con autorización
     */
    function authHeaders(token, withJson) {
        return withJson
            ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
            : { 'Authorization': `Bearer ${token}` };
    }

    /**
     * Obtiene las canciones favoritas del usuario desde el servidor
     * @returns {Promise<Array>} Array de canciones favoritas
     */
    async function fetchLikedSongs() {
        try {
            const token = localStorage.getItem('token');
            if (!token) return [];
            const response = await fetch('/liked-songs', {
                headers: authHeaders(token, false)
            });
            if (!response.ok) {
                // Si el token expiró (403), redirigir a login
                if (response.status === 403) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.href = 'login.html';
                    return [];
                }
                throw new Error('Failed to fetch liked songs');
            }
            const result = await response.json();
            return result.liked_songs || [];
        } catch (error) {
            console.error('Error fetching liked songs:', error);
            return [];
        }
    }

    /**
     * Guarda o elimina una canción de favoritos en el servidor
     * @param {Object|string} songOrId - Objeto canción o ID de canción
     * @param {string} action - 'add' o 'remove'
     */
    async function saveLikedSong(songOrId, action) {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const endpoint = action === 'remove' ? '/remove-liked-song' : '/add-liked-song';
            const method = action === 'remove' ? 'DELETE' : 'POST';
            const songId = typeof songOrId === 'string' ? songOrId : songOrId.id;
            let body;
            if (action === 'remove') {
                body = JSON.stringify({ song_id: songId });
            } else {
                const songObj = typeof songOrId === 'object'
                    ? songOrId
                    : { id: songId, title: '', author: '', duration: 0, thumbnail: '' };
                body = JSON.stringify({ song: {
                    id: songObj.id,
                    title: songObj.title || '',
                    author: songObj.author || '',
                    duration: songObj.duration || 0,
                    thumbnail: songObj.thumbnail || ''
                }});
            }
            const response = await fetch(endpoint, {
                method,
                headers: authHeaders(token, true),
                body
            });
            if (!response.ok) throw new Error('Failed to save liked song');
        } catch (error) {
            console.error('Error saving liked song:', error);
        }
    }

    /**
     * Obtiene el historial de canciones reproducidas del usuario
     * @returns {Promise<Array>} Array de canciones reproducidas
     */
    async function fetchRecentlyPlayed() {
        try {
            const token = localStorage.getItem('token');
            if (!token) return [];
            const response = await fetch('/recently-played', {
                headers: authHeaders(token, false)
            });
            if (!response.ok) throw new Error('Failed to fetch recently played');
            const result = await response.json();
            return result.recently_played || [];
        } catch (error) {
            console.error('Error fetching recently played:', error);
            return [];
        }
    }

    /**
     * Guarda una canción en el historial de reproducción
     * @param {Object} song - Canción reproducida
     */
    async function saveRecentlyPlayed(song) {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const response = await fetch('/add-recently-played', {
                method: 'POST',
                headers: authHeaders(token, true),
                body: JSON.stringify({ song })
            });
            if (!response.ok) throw new Error('Failed to save recently played');
        } catch (error) {
            console.error('Error saving recently played:', error);
        }
    }

    async function fetchAutoGeneratedPlaylists() {
        try {
            const token = localStorage.getItem('token');
            if (!token) return [];
            const response = await fetch('/auto-generated-playlists', {
                headers: authHeaders(token, false)
            });
            if (!response.ok) throw new Error('Failed to fetch auto-generated playlists');
            const result = await response.json();
            return result.auto_playlists || [];
        } catch (error) {
            console.error('Error fetching auto-generated playlists:', error);
            return [];
        }
    }

    async function saveAutoGeneratedPlaylist(playlist) {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const response = await fetch('/create-auto-generated-playlist', {
                method: 'POST',
                headers: authHeaders(token, true),
                body: JSON.stringify(playlist)
            });
            if (!response.ok) throw new Error('Failed to save auto-generated playlist');
        } catch (error) {
            console.error('Error saving auto-generated playlist:', error);
        }
    }

    async function getOrCreatePlaylist(name) {
        try {
            const token = localStorage.getItem('token');
            if (!token) return null;

            const response = await fetch('/user-playlists', {
                headers: authHeaders(token, false)
            });
            if (!response.ok) throw new Error('Failed to fetch playlists');
            const result = await response.json();
            const playlists = result.playlists || [];

            const existing = playlists.find(p => p.name === name);
            if (existing) return existing.id;

            const createResponse = await fetch('/create-playlist', {
                method: 'POST',
                headers: authHeaders(token, true),
                body: JSON.stringify({ name })
            });
            if (!createResponse.ok) throw new Error('Failed to create playlist');
            const createResult = await createResponse.json();
            return createResult.playlist.id;
        } catch (error) {
            console.error('Error getting or creating playlist:', error);
            return null;
        }
    }

    window.EsplotifyApi = {
        fetchLikedSongs,
        saveLikedSong,
        fetchRecentlyPlayed,
        saveRecentlyPlayed,
        fetchAutoGeneratedPlaylists,
        saveAutoGeneratedPlaylist,
        getOrCreatePlaylist,
    };
})();
