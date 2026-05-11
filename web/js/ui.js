/**
 * ========================================
 * MÓDULO DE INTERFAZ - Componentes de UI
 * ========================================
 * Propósito: Construye y gestiona los componentes de interfaz reutilizables
 *
 * Funcionalidades:
 * - Toast de notificación temporal (showToast)
 * - Portada de playlist con fallback SVG (getPlaylistCover)
 * - Prefetch de canciones para carga anticipada (prefetchSongs)
 * - Menú contextual de canción con 3 puntos (showSongContextMenu)
 * - Botones de acción por canción: like y más opciones (buildSongActions)
 * - Bindings globales de UI: biblioteca, filtros, sidebar, scroll (initUiBindings)
 */
(function () {
    function createUiModule(deps) {
        const {
            isLiked,
            toggleLikeSong,
            addSongToQueueUnique,
            getCurrentIndex,
            getPlaylist,
            setPlaylist,
            openArtistPage,
            getCurrentSong,
            setCurrentSong,
            openAddToPlaylistModal,
            filterSidebarPlaylists,
            openCreatePlaylistModal,
            showHomeView,
            showSearchView,
            fetchImpl,
        } = deps;

        // Canción sobre la que se abrió el menú contextual (3 puntos)
        let scmSong = null;

        /**
         * Muestra una notificación temporal en la parte inferior de la pantalla
         * Desaparece automáticamente después de 2.5 segundos
         * @param {string} message - Texto a mostrar
         */
        function showToast(message) {
            let t = document.getElementById('esplotifyToast');
            if (!t) {
                t = document.createElement('div');
                t.id = 'esplotifyToast';
                t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#282828;color:#fff;padding:10px 20px;border-radius:4px;font-size:14px;z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,0.5);pointer-events:none;transition:opacity 0.3s;';
                document.body.appendChild(t);
            }
            t.textContent = message;
            t.style.opacity = '1';
            clearTimeout(t._timeout);
            t._timeout = setTimeout(() => { t.style.opacity = '0'; }, 2500);
        }

        /**
         * Genera la URL de portada de una playlist
         * Si no tiene cover, genera un SVG con la inicial del nombre como fallback
         * @param {Object} playlist - Objeto playlist
         * @returns {string} URL de imagen o data URI SVG
         */
        function getPlaylistCover(playlist) {
            if (playlist && playlist.cover) return playlist.cover;
            const name = (playlist && typeof playlist.name === 'string') ? playlist.name : '?';
            const letter = name && name.length > 0 ? name.charAt(0).toUpperCase() : '?';
            const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" fill="#333"/><text x="20" y="25" font-family="Arial" font-size="20" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
            return 'data:image/svg+xml;base64,' + btoa(svg);
        }

        /**
         * Solicita al servidor que precargue las URLs de audio de las primeras 5 canciones
         * Reduce el tiempo de espera al reproducir canciones cercanas en la cola
         * @param {Array} songs - Array de canciones a precargar
         */
        function prefetchSongs(songs) {
            if (!songs || songs.length === 0) return;
            const ids = songs.slice(0, 5).map(s => s.id || s.song_id).filter(Boolean);
            if (ids.length === 0) return;
            fetchImpl('/prefetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
            }).catch(() => {});
        }

        /**
         * Muestra el menú contextual (3 puntos) de una canción
         * Posiciona el menú evitando que se salga de los bordes de la ventana
         * Actualiza el texto del botón de like según si ya está en favoritos
         * @param {MouseEvent} e - Evento de click para obtener posición
         * @param {Object} song - Canción sobre la que se abre el menú
         */
        function showSongContextMenu(e, song) {
            scmSong = song;
            const menu = document.getElementById('songContextMenu');
            menu.style.display = 'block';

            const mw = 230;
            const mh = 180;
            let x = e.clientX;
            let y = e.clientY;
            if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
            if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            const addLikedItem = document.getElementById('scmAddLiked');
            if (addLikedItem) {
                const alreadyLiked = isLiked(song.id);
                addLikedItem.querySelector('span').textContent = alreadyLiked
                    ? 'Quitar de canciones que te gustan'
                    : 'Anadir a canciones que te gustan';
            }
        }

        /**
         * Oculta el menú contextual de canción y limpia la referencia a la canción activa
         */
        function hideSongContextMenu() {
            document.getElementById('songContextMenu').style.display = 'none';
            scmSong = null;
        }

        /**
         * Construye el bloque de botones de acción para una canción en cualquier lista
         * Devuelve un div con: botón de like (corazón) y botón de más opciones (3 puntos)
         * El corazón se pinta verde si la canción ya está en favoritos
         * @param {Object} song - Objeto canción
         * @returns {HTMLElement} Contenedor con los botones de acción
         */
        function buildSongActions(song) {
            const wrap = document.createElement('div');
            wrap.className = 'song-actions';

            const liked = isLiked(song.id);
            const heartBtn = document.createElement('button');
            heartBtn.className = 'song-like-btn' + (liked ? ' liked' : '');
            heartBtn.setAttribute('data-song-id', song.id);
            heartBtn.setAttribute('aria-label', liked ? 'Quitar de canciones que te gustan' : 'Anadir a canciones que te gustan');
            heartBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                      fill="${liked ? '#1DB954' : 'none'}"
                      stroke="${liked ? '#1DB954' : 'currentColor'}"
                      stroke-width="1.5"/>
            </svg>`;
            heartBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                toggleLikeSong(song);
            });

            const moreBtn = document.createElement('button');
            moreBtn.className = 'song-more-btn';
            moreBtn.setAttribute('aria-label', 'Mas opciones');
            moreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/>
            </svg>`;
            moreBtn.addEventListener('click', (evt) => {
                evt.stopPropagation();
                showSongContextMenu(evt, song);
            });

            wrap.appendChild(heartBtn);
            wrap.appendChild(moreBtn);
            return wrap;
        }

        /**
         * Inicializa todos los eventos globales de la interfaz tras cargar el DOM:
         * - Cierra el menú contextual al hacer clic fuera
         * - Opciones del menú: añadir a cola, ir al artista, añadir a playlist, like, compartir
         * - Filtro de búsqueda en la vista de biblioteca
         * - Toggle de vista cuadrícula/lista en biblioteca
         * - Filtros de categoría (pills) en biblioteca y sidebar
         * - Búsqueda en la sidebar con apertura/cierre animado
         * - Botón de crear playlist
         * - Efecto de scroll en la barra superior (topBar)
         */
        function initUiBindings() {
            document.addEventListener('DOMContentLoaded', () => {
                document.addEventListener('click', (evt) => {
                    const menu = document.getElementById('songContextMenu');
                    if (menu && !menu.contains(evt.target)) hideSongContextMenu();
                });

                document.getElementById('scmAddToQueue')?.addEventListener('click', () => {
                    if (!scmSong) return;
                    const song = scmSong;
                    hideSongContextMenu();
                    const playlist = getPlaylist();
                    const insertAt = getCurrentIndex() >= 0 ? getCurrentIndex() + 1 : playlist.length;
                    const idx = addSongToQueueUnique(song, insertAt);
                    if (idx === insertAt) {
                        showToast(`"${song.title}" anadida a la cola`);
                    } else if (idx >= 0) {
                        const nextPlaylist = getPlaylist();
                        const [moved] = nextPlaylist.splice(idx, 1);
                        const target = idx < insertAt ? Math.max(0, insertAt - 1) : insertAt;
                        nextPlaylist.splice(target, 0, moved);
                        setPlaylist(nextPlaylist);
                        showToast(`"${song.title}" movida al inicio de la cola`);
                    }
                    if (typeof window._rpRenderQueue === 'function') window._rpRenderQueue();
                    if (typeof window._rpRenderNowPlaying === 'function') window._rpRenderNowPlaying();
                });

                document.getElementById('scmGoArtist')?.addEventListener('click', () => {
                    if (!scmSong) return;
                    hideSongContextMenu();
                    openArtistPage(scmSong.author || '');
                });

                document.getElementById('scmAddToPlaylist')?.addEventListener('click', () => {
                    if (!scmSong) return;
                    const songForModal = scmSong;
                    hideSongContextMenu();
                    const prev = getCurrentSong();
                    setCurrentSong(songForModal);
                    openAddToPlaylistModal(null);
                    setCurrentSong(prev);
                });

                document.getElementById('scmAddLiked')?.addEventListener('click', () => {
                    if (!scmSong) return;
                    toggleLikeSong(scmSong);
                    hideSongContextMenu();
                });

                document.getElementById('scmShare')?.addEventListener('click', () => {
                    if (!scmSong) return;
                    const url = `https://music.youtube.com/watch?v=${scmSong.id}`;
                    navigator.clipboard?.writeText(url).then(() => {
                        showToast('Enlace copiado al portapapeles');
                    });
                    hideSongContextMenu();
                });

                const libSearch = document.getElementById('librarySearchInput');
                libSearch?.addEventListener('input', () => {
                    const q = libSearch.value.toLowerCase().trim();
                    document.querySelectorAll('#libraryGrid .playlist-card').forEach(card => {
                        const name = card.querySelector('.pl-card-name')?.textContent.toLowerCase() || '';
                        card.style.display = (!q || name.includes(q)) ? '' : 'none';
                    });
                });

                const libToggle = document.getElementById('libViewToggle');
                let libListView = false;
                const svgGrid = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/></svg>';
                const svgList = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>';
                libToggle?.addEventListener('click', () => {
                    libListView = !libListView;
                    const grid = document.getElementById('libraryGrid');
                    if (libListView) {
                        grid?.classList.add('list-view');
                        libToggle.innerHTML = svgGrid;
                    } else {
                        grid?.classList.remove('list-view');
                        libToggle.innerHTML = svgList;
                    }
                });

                document.getElementById('libraryFilterPills')?.addEventListener('click', (evt) => {
                    const pill = evt.target.closest('.lib-filter-pill');
                    if (!pill) return;
                    document.querySelectorAll('.lib-filter-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                });

                document.getElementById('sidebarLibFilters')?.addEventListener('click', (evt) => {
                    const pill = evt.target.closest('.sidebar-lib-pill');
                    if (!pill) return;
                    document.querySelectorAll('.sidebar-lib-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                });

                const sidebarLibSearchBtn = document.getElementById('sidebarLibSearchBtn');
                const sidebarLibSearchEl = document.getElementById('sidebarLibSearch');
                const sidebarLibSearchInput = document.getElementById('sidebarLibSearchInput');
                if (sidebarLibSearchBtn && sidebarLibSearchEl && sidebarLibSearchInput) {
                    sidebarLibSearchBtn.addEventListener('click', () => {
                        const isOpen = sidebarLibSearchEl.classList.toggle('open');
                        if (isOpen) {
                            sidebarLibSearchInput.focus();
                        } else {
                            sidebarLibSearchInput.value = '';
                            filterSidebarPlaylists('');
                        }
                    });
                    sidebarLibSearchInput.addEventListener('input', (evt) => filterSidebarPlaylists(evt.target.value));
                    sidebarLibSearchInput.addEventListener('keydown', (evt) => {
                        if (evt.key === 'Escape') {
                            sidebarLibSearchEl.classList.remove('open');
                            sidebarLibSearchInput.value = '';
                            filterSidebarPlaylists('');
                        }
                    });
                }

                document.getElementById('createPlaylistBtn')?.addEventListener('click', () => openCreatePlaylistModal());

                const contentEl = document.querySelector('.content');
                const topBar = document.getElementById('topBar');
                if (contentEl && topBar) {
                    contentEl.addEventListener('scroll', () => {
                        if (contentEl.scrollTop > 20) {
                            topBar.classList.add('scrolled');
                        } else {
                            topBar.classList.remove('scrolled');
                        }
                    }, { passive: true });
                }

                document.getElementById('topBrowseBtn')?.addEventListener('click', () => {
                    const searchView = document.getElementById('searchView');
                    const btn = document.getElementById('topBrowseBtn');
                    if (searchView && searchView.style.display !== 'none') {
                        btn?.classList.remove('active');
                        showHomeView();
                    } else {
                        btn?.classList.add('active');
                        showSearchView();
                    }
                });
            });
        }

        return {
            buildSongActions,
            showSongContextMenu,
            hideSongContextMenu,
            showToast,
            getPlaylistCover,
            prefetchSongs,
            initUiBindings,
        };
    }

    window.EsplotifyUi = {
        createUiModule,
    };
})();
