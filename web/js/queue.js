/**
 * ========================================
 * MÓDULO DE COLA - Gestión de Reproducción
 * ========================================
 * Propósito: Gestiona la cola de reproducción (playlist)
 * 
 * Funcionalidades:
 * - Añadir canciones sin duplicados
 * - Establecer nueva cola y reproducir canción seleccionada
 * - Prevención de duplicados usando normalización de títulos
 */
(function () {
    function createQueueModule(deps) {
        const {
            getPlaylist,
            setPlaylist,
            playSongAtIndex,
            normalizeSongTitle,
        } = deps;

        /**
         * Añade una canción a la cola sin duplicarla
         * @param {Object} song - Canción a añadir
         * @param {number|null} insertAt - Índice donde insertar (null = al final)
         * @returns {number} Índice donde se insertó (-1 si ya existe o error)
         */
        function addSongToQueueUnique(song, insertAt = null) {
            if (!song) return -1;
            const key = normalizeSongTitle(song.title);
            if (!key) return -1;

            const playlist = getPlaylist();
            
            // Busca si ya existe una canción con el mismo título normalizado
            const existingIndex = playlist.findIndex(s => normalizeSongTitle(s && s.title) === key);
            if (existingIndex !== -1) return existingIndex;

            // Inserta en la posición especificada o al final
            if (Number.isInteger(insertAt) && insertAt >= 0 && insertAt <= playlist.length) {
                playlist.splice(insertAt, 0, song);
                setPlaylist(playlist);
                return insertAt;
            }

            playlist.push(song);
            setPlaylist(playlist);
            return playlist.length - 1;
        }

        /**
         * Establece una nueva cola de reproducción y reproduce la canción seleccionada
         * Elimina duplicados automáticamente
         * @param {Array} sourceSongs - Array de canciones origen
         * @param {Object} selectedSong - Canción que se debe reproducir
         */
        function setQueueAndPlayFromSongs(sourceSongs, selectedSong) {
            const selectedKey = normalizeSongTitle(selectedSong && selectedSong.title);
            const selectedId = selectedSong && selectedSong.id;

            const queueSongs = [];
            const keyToIndex = new Map();

            // Construye la cola sin duplicados
            for (const song of (sourceSongs || [])) {
                const key = normalizeSongTitle(song && song.title);
                if (!key) continue;

                if (!keyToIndex.has(key)) {
                    // Primera vez que vemos este título
                    keyToIndex.set(key, queueSongs.length);
                    queueSongs.push(song);
                    continue;
                }

                // Si el usuario seleccionó específicamente esta versión del duplicado, úsala
                if (selectedKey && key === selectedKey && selectedId && song && song.id === selectedId) {
                    const replaceIdx = keyToIndex.get(key);
                    queueSongs[replaceIdx] = song;
                }
            }

            if (!queueSongs.length) return;
            setPlaylist(queueSongs);

            // Encuentra el índice de la canción seleccionada
            let idx = 0;
            if (selectedSong) {
                const byId = selectedId
                    ? queueSongs.findIndex(s => s && s.id === selectedId)
                    : -1;
                const byTitle = selectedKey
                    ? queueSongs.findIndex(s => normalizeSongTitle(s && s.title) === selectedKey)
                    : -1;
                idx = byId >= 0 ? byId : (byTitle >= 0 ? byTitle : 0);
            }

            playSongAtIndex(idx);
        }

        return {
            addSongToQueueUnique,
            setQueueAndPlayFromSongs,
        };
    }

    window.EsplotifyQueue = {
        createQueueModule,
    };
})();
