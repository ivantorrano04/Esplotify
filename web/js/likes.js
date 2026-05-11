/**
 * ========================================
 * MÓDULO DE LIKES - Sistema de "Me Gusta"
 * ========================================
 * Propósito: Gestiona el sistema de canciones favoritas
 * 
 * Funcionalidades:
 * - Añadir/quitar canciones de favoritos
 * - Sincronización con backend y localStorage
 * - Actualización automática de UI (botones de like)
 * - Integración con panel "Now Playing"
 */
(function () {
    function createLikesModule(config) {
        const {
            state,
            deps,
        } = config;

        const {
            likeBtn,
            saveLikedSong,
            saveLikedSongs,
            getLikedSongsPlaylist,
            saveLikedSongsPlaylist,
        } = deps;

        /**
         * Verifica si una canción está en favoritos
         * @param {string} songId - ID de la canción
         * @returns {boolean} True si está en favoritos
         */
        function isLiked(songId) {
            return state.getLikedSongs().includes(songId);
        }

        /**
         * Actualiza el botón de like del reproductor principal
         * Cambia el color del corazón según si la canción está en favoritos
         */
        function updateLikeButton() {
            const currentSong = state.getCurrentSong();
            if (!currentSong) return;
            const path = likeBtn.querySelector('path');
            if (path) {
                path.setAttribute('fill', isLiked(currentSong.id) ? '#1DB954' : 'none');
            }
            // Actualiza también el panel "Now Playing" si está disponible
            if (typeof window._rpRenderNowPlaying === 'function') window._rpRenderNowPlaying();
        }

        /**
         * Añade o quita una canción de favoritos (toggle)
         * Sincroniza con backend y actualiza todos los botones de like
         * @param {Object} song - Objeto canción
         */
        function toggleLike(song) {
            const likedSongs = state.getLikedSongs();
            const index = likedSongs.indexOf(song.id);
            
            if (index > -1) {
                // Quitar de favoritos
                likedSongs.splice(index, 1);
                saveLikedSong(song.id, 'remove');
            } else {
                // Añadir a favoritos
                likedSongs.push(song.id);
                saveLikedSong(song, 'add');
            }
            
            state.setLikedSongs(likedSongs);
            saveLikedSongs();
            updateLikeButton();

            // Actualiza todos los botones de like de esta canción en la UI
            document.querySelectorAll(`.song-like-btn[data-song-id="${song.id}"]`).forEach(btn => {
                const liked = isLiked(song.id);
                btn.classList.toggle('liked', liked);
                const p = btn.querySelector('path');
                if (p) {
                    p.setAttribute('fill', liked ? '#1DB954' : 'none');
                    p.setAttribute('stroke', liked ? '#1DB954' : 'currentColor');
                }
            });
        }

        /**
         * Toggle de favoritos con actualización de la playlist "Canciones favoritas"
         * @param {Object} song - Objeto canción
         */
        function toggleLikeSong(song) {
            const wasLiked = isLiked(song.id);
            toggleLike(song);

            // Actualiza la playlist de favoritos en localStorage
            const playlist = getLikedSongsPlaylist();
            if (wasLiked) {
                // Quitar de la playlist
                const i = playlist.findIndex(s => s.id === song.id);
                if (i > -1) playlist.splice(i, 1);
            } else if (!playlist.find(s => s.id === song.id)) {
                // Añadir al inicio de la playlist
                playlist.unshift(song);
            }
            saveLikedSongsPlaylist(playlist);
        }

        return {
            toggleLike,
            isLiked,
            updateLikeButton,
            toggleLikeSong,
        };
    }

    window.EsplotifyLikes = {
        createLikesModule,
    };
})();
