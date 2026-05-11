/**
 * ========================================
 * MÓDULO DE RESULTADOS - Renderizado de Búsqueda
 * ========================================
 * Propósito: Renderiza los resultados de búsqueda en la vista principal
 *
 * Estructura de resultados mostrados:
 * - "Mejor resultado": tarjeta grande con la primera canción
 * - "Canciones": lista de las siguientes 5 canciones
 * - "Más canciones": resto de canciones numeradas
 * - Otras categorías: listas adicionales agrupadas por categoría
 * - "Álbumes y listas": cuadrícula de álbumes con portada y título
 *
 * Todas las canciones se añaden a una cola de búsqueda local para
 * permitir navegación secuencial durante la sesión de búsqueda
 */
(function () {
    function createResultsModule(deps) {
        const {
            resultsDiv,
            formatDuration,
            buildSongActions,
            setQueueAndPlayFromSongs,
            openAlbumView,
            prefetchSongs,
        } = deps;

        /**
         * Renderiza todos los resultados de búsqueda categorizados en el DOM
         * @param {Object} categorizedSongs - Objeto con categorías como claves y arrays de canciones como valores
         *   Categorías especiales: 'Canciones' (top results) y 'Albums' (cuadrícula)
         *   Resto de claves se renderizan como secciones adicionales
         */
        function displayResults(categorizedSongs) {
            resultsDiv.innerHTML = '';
            const searchQueue = [];

            // Cola local de búsqueda: mantiene el orden de reproducción dentro de los resultados

            /**
             * Añade una canción a la cola de búsqueda local
             * @param {Object} song - Canción a añadir
             * @returns {number} Índice asignado en la cola
             */
            function queueSearchSong(song) {
                searchQueue.push(song);
                return searchQueue.length - 1;
            }

            /**
             * Inicia la reproducción desde la cola de búsqueda en el índice indicado
             * Marca la sesión como búsqueda activa para mantener el contexto de cola
             * @param {number} i - Índice de la canción en la cola de búsqueda
             */
            function playFromSearchIndex(i) {
                const selected = searchQueue[i];
                if (!selected) return;
                window._isSearchPlaylist = true;
                setQueueAndPlayFromSongs(searchQueue, selected);
            }

            document.querySelectorAll('.song-row, .song-card, .song-table-row, .popular-song-item, .top-song-row').forEach(el => {
                el.classList.remove('playing');
            });

            const canciones = categorizedSongs['Canciones'] || [];
            const albums = categorizedSongs['Albums'] || [];
            const otherCategories = Object.entries(categorizedSongs)
                .filter(([k]) => k !== 'Canciones' && k !== 'Albums');
            const hasAny = canciones.length > 0 || albums.length > 0 || otherCategories.some(([, v]) => v.length > 0);

            if (!hasAny) {
                resultsDiv.innerHTML = '<p class="no-results-msg">No se encontraron resultados</p>';
                return;
            }

            if (canciones.length > 0) {
                const topSection = document.createElement('div');
                topSection.className = 'search-results-top';

                const firstSong = canciones[0];
                const firstIdx = queueSearchSong(firstSong);

                const topResultSection = document.createElement('div');
                topResultSection.className = 'top-result-section';
                topResultSection.innerHTML = '<h2>Mejor resultado</h2>';

                const topCard = document.createElement('div');
                topCard.className = 'top-result-card';
                topCard.setAttribute('data-index', firstIdx);
                topCard.innerHTML = `
                    <img src="${firstSong.thumbnail}" alt="${firstSong.title}" class="top-result-thumbnail">
                    <div class="top-result-info">
                        <div class="top-result-title">${firstSong.title}</div>
                        <div class="top-result-meta">
                            <span class="top-result-type-badge">Cancion</span>
                            <span>${firstSong.author}</span>
                        </div>
                    </div>
                    <button class="top-result-play">
                        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
                    </button>
                `;
                topCard.querySelector('.top-result-play').addEventListener('click', (e) => {
                    e.stopPropagation();
                    playFromSearchIndex(firstIdx);
                });
                topCard.addEventListener('click', () => playFromSearchIndex(firstIdx));
                topResultSection.appendChild(topCard);
                topSection.appendChild(topResultSection);

                const songsSection = document.createElement('div');
                songsSection.className = 'top-songs-section';
                songsSection.innerHTML = '<h2>Canciones</h2>';

                const songsList = document.createElement('div');
                songsList.className = 'top-songs-list';

                canciones.slice(1, 6).forEach(song => {
                    const gIdx = queueSearchSong(song);
                    const row = document.createElement('div');
                    row.className = 'top-song-row';
                    row.setAttribute('data-index', gIdx);
                    row.innerHTML = `
                        <img src="${song.thumbnail}" alt="${song.title}" class="top-song-thumb">
                        <div class="top-song-info">
                            <div class="top-song-title">${song.title}</div>
                            <div class="top-song-author">${song.author}</div>
                        </div>
                        <span class="top-song-duration">${formatDuration(song.duration)}</span>
                    `;
                    row.appendChild(buildSongActions(song));
                    row.addEventListener('click', (e) => {
                        if (!e.target.closest('.song-actions')) playFromSearchIndex(gIdx);
                    });
                    songsList.appendChild(row);
                });
                songsSection.appendChild(songsList);
                topSection.appendChild(songsSection);
                resultsDiv.appendChild(topSection);

                if (canciones.length > 6) {
                    const moreSection = document.createElement('div');
                    moreSection.className = 'category-section';
                    const moreTitle = document.createElement('h2');
                    moreTitle.className = 'category-title';
                    moreTitle.textContent = 'Mas canciones';
                    moreSection.appendChild(moreTitle);
                    const moreList = document.createElement('div');
                    moreList.className = 'popular-list';
                    canciones.slice(6).forEach((song, idx) => {
                        const gIdx = queueSearchSong(song);
                        const row = document.createElement('div');
                        row.className = 'popular-song-item';
                        row.setAttribute('data-index', gIdx);
                        row.innerHTML = `
                            <div class="song-num-cell">
                                <span class="song-num-label">${idx + 7}</span>
                                <svg class="song-num-play" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
                            </div>
                            <img src="${song.thumbnail}" alt="${song.title}" class="song-thumbnail-small">
                            <div class="song-info">
                                <div class="song-title">${song.title}</div>
                                <div class="song-meta"><span class="play-count">${song.author}</span></div>
                            </div>
                            <div class="song-duration">${formatDuration(song.duration)}</div>
                        `;
                        row.appendChild(buildSongActions(song));
                        row.addEventListener('click', (e) => {
                            if (!e.target.closest('.song-actions')) playFromSearchIndex(gIdx);
                        });
                        moreList.appendChild(row);
                    });
                    moreSection.appendChild(moreList);
                    resultsDiv.appendChild(moreSection);
                }
            }

            otherCategories.forEach(([category, songs]) => {
                if (songs.length === 0) return;
                const section = document.createElement('div');
                section.className = 'category-section';
                const title = document.createElement('h2');
                title.className = 'category-title';
                title.textContent = category;
                section.appendChild(title);
                const songList = document.createElement('div');
                songList.className = 'popular-list';
                songs.forEach((song, index) => {
                    const gIdx = queueSearchSong(song);
                    const row = document.createElement('div');
                    row.className = 'popular-song-item';
                    row.setAttribute('data-index', gIdx);
                    row.innerHTML = `
                        <div class="song-num-cell">
                            <span class="song-num-label">${index + 1}</span>
                            <svg class="song-num-play" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
                        </div>
                        <img src="${song.thumbnail}" alt="${song.title}" class="song-thumbnail-small">
                        <div class="song-info">
                            <div class="song-title">${song.title}</div>
                            <div class="song-meta"><span class="play-count">${song.author}</span></div>
                        </div>
                        <div class="song-duration">${formatDuration(song.duration)}</div>
                    `;
                    row.appendChild(buildSongActions(song));
                    row.addEventListener('click', (e) => {
                        if (!e.target.closest('.song-actions')) playFromSearchIndex(gIdx);
                    });
                    songList.appendChild(row);
                });
                section.appendChild(songList);
                resultsDiv.appendChild(section);
            });

            if (albums.length > 0) {
                const albumSection = document.createElement('div');
                albumSection.className = 'category-section';
                const albumTitle = document.createElement('h2');
                albumTitle.className = 'category-title';
                albumTitle.textContent = 'Albumes y listas';
                albumSection.appendChild(albumTitle);

                const albumGrid = document.createElement('div');
                albumGrid.className = 'album-card-grid';
                albums.forEach(album => {
                    const card = document.createElement('div');
                    card.className = 'album-card';
                    card.dataset.albumId = album.id;
                    card.dataset.albumTitle = album.title;
                    card.dataset.albumThumb = album.thumbnail;
                    card.innerHTML = `
                        <div class="album-card-img-wrap">
                            <img src="${album.thumbnail}" alt="${album.title}" class="album-card-img" loading="lazy">
                            <button class="album-card-play" aria-label="Reproducir album">
                                <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                            </button>
                        </div>
                        <div class="album-card-info">
                            <div class="album-card-title">${album.title}</div>
                            <div class="album-card-meta">${album.videoCount > 0 ? album.videoCount + ' canciones' : 'Lista'}</div>
                        </div>
                    `;
                    card.querySelector('.album-card-play').addEventListener('click', (e) => {
                        e.stopPropagation();
                        openAlbumView(album.id, album.title, album.thumbnail);
                    });
                    card.addEventListener('click', () => openAlbumView(album.id, album.title, album.thumbnail));
                    albumGrid.appendChild(card);
                });
                albumSection.appendChild(albumGrid);
                resultsDiv.appendChild(albumSection);
            }

            const allSongs = [].concat(canciones, ...otherCategories.map(([, v]) => v));
            prefetchSongs(allSongs);
        }

        return {
            displayResults,
        };
    }

    window.EsplotifyResults = {
        createResultsModule,
    };
})();
