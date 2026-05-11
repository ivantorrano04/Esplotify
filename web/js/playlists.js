/**
 * ========================================
 * MÓDULO DE PLAYLISTS - Gestión de Listas de Reproducción
 * ========================================
 * Propósito: Maneja toda la lógica de playlists del usuario
 *
 * Funcionalidades:
 * - Crear playlists con modal y validación (openCreatePlaylistModal / createPlaylist)
 * - Cargar y mostrar canciones de una playlist (loadAndDisplayPlaylist)
 * - Eliminar playlists con confirmación (deletePlaylist)
 * - Añadir canciones a una playlist desde el menú contextual (addToPlaylist)
 * - Renderizar playlists en la sidebar con botón de 3 puntos (displayPlaylists)
 * - Menú contextual flotante para acciones rápidas (showPlaylistContextMenu)
 * - Filtrar playlists en la sidebar por texto (filterSidebarPlaylists)
 * - Renderizar la vista de biblioteca con cuadrícula de playlists (displayLibrary)
 * - Cargar todas las playlists del usuario desde el servidor (loadPlaylists)
 */
(function () {
    function createPlaylistsModule(deps) {
        const {
            readJsonResponse,
            prefetchSongs,
            displayPlaylistView,
            showLibraryView,
            showSearchView,
            openLikedSongsView,
            getPlaylistCover,
            getLikedSongsPlaylist,
            dedupeSongsByTitle,
            getPlaylistState,
            setPlaylistState,
            playSongAtIndex,
            fetchImpl,
        } = deps;

        /**
         * Abre el modal de creación de playlist
         * Limpia campos anteriores y configura atajos de teclado (Enter/Escape)
         * Evita acumulación de listeners si el modal se abre varias veces
         */
        function openCreatePlaylistModal() {
            const modal = document.getElementById('createPlaylistModal');
            const input = document.getElementById('playlistNameInput');
            const msg = document.getElementById('createPlaylistMessage');
            if (!modal) return;

            // Limpiar listener anterior ANTES de añadir uno nuevo
            // Evita que se acumulen listeners si el modal se abre varias veces
            if (modal._cleanupKeydown) {
                modal._cleanupKeydown();
                delete modal._cleanupKeydown;
            }

            if (input) input.value = '';
            const descEl = document.getElementById('playlistDescInput');
            if (descEl) descEl.value = '';
            if (msg) msg.textContent = '';

            modal.style.display = 'flex';
            requestAnimationFrame(() => input?.focus());

            function onKeydown(e) {
                if (e.key === 'Enter') { e.preventDefault(); createPlaylist(); }
                if (e.key === 'Escape') { e.preventDefault(); closeCreatePlaylistModal(); }
            }

            input?.addEventListener('keydown', onKeydown);
            modal._cleanupKeydown = () => input?.removeEventListener('keydown', onKeydown);
        }

        /**
         * Cierra el modal de creación de playlist y limpia sus campos y listeners
         */
        function closeCreatePlaylistModal() {
            const modal = document.getElementById('createPlaylistModal');
            if (!modal) return;
            modal.style.display = 'none';
            const nameEl = document.getElementById('playlistNameInput');
            const msgEl = document.getElementById('createPlaylistMessage');
            if (nameEl) nameEl.value = '';
            if (msgEl) msgEl.textContent = '';
            if (modal._cleanupKeydown) {
                modal._cleanupKeydown();
                delete modal._cleanupKeydown;
            }
        }

        /**
         * Envía la petición al servidor para crear una nueva playlist
         * Valida que el nombre no esté vacío y requiere token de sesión
         * Al crearse con éxito, cierra el modal y recarga la vista de biblioteca
         */
        async function createPlaylist() {
            const name = document.getElementById('playlistNameInput').value.trim();
            if (!name) {
                document.getElementById('createPlaylistMessage').textContent = 'Por favor, ingresa un nombre para la playlist.';
                return;
            }
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    alert('Debes iniciar sesion para crear playlists.');
                    window.location.href = 'login.html';
                    return;
                }
                const response = await fetchImpl('/create-playlist', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ name }),
                });
                const result = await response.json();
                if (result.success) {
                    closeCreatePlaylistModal();
                    showLibraryView();
                } else {
                    document.getElementById('createPlaylistMessage').textContent = 'Error al crear la playlist: ' + result.message;
                }
            } catch (error) {
                console.error('Error:', error);
                document.getElementById('createPlaylistMessage').textContent = 'Error al procesar la solicitud.';
            }
        }

        /**
         * Carga las canciones de una playlist desde el servidor y abre la vista de playlist
         * Hace prefetch de las primeras canciones para carga más rápida al reproducir
         * @param {number|string} playlistId - ID de la playlist
         * @param {string} playlistNameFallback - Nombre a mostrar si el servidor no lo devuelve
         */
        async function loadAndDisplayPlaylist(playlistId, playlistNameFallback) {
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    alert('Debes iniciar sesion para ver playlists.');
                    window.location.href = 'login.html';
                    return;
                }

                const response = await fetchImpl(`/playlist-songs?playlist_id=${playlistId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();

                if (result.error) {
                    alert('Error: ' + result.error);
                    return;
                }

                if (!result.playlist || !Array.isArray(result.songs)) {
                    alert('Formato de playlist invalido.');
                    return;
                }

                const playlistData = {
                    playlistId: playlistId,  // Bug D fix: pasar el ID para poder eliminar canciones
                    playlistName: result.playlist.name || playlistNameFallback || 'Sin nombre',
                    songs: result.songs,
                    owner: 'Tu',
                };

                prefetchSongs(result.songs);
                displayPlaylistView(playlistData);
            } catch (error) {
                console.error('Error al cargar playlist:', error);
                alert('No se pudo cargar la playlist.');
            }
        }

        // ─── Menú contextual flotante para playlists de la sidebar ───────────────
        // Solo puede haber un menú abierto a la vez; se guarda la referencia aquí
        let _plCtxMenu = null;

        /**
         * Muestra un menú contextual flotante junto al botón de 3 puntos de una playlist
         * Opciones: "Abrir playlist" y "Eliminar playlist"
         * Se posiciona para evitar que se salga de los bordes de la ventana
         * Se cierra automáticamente al hacer clic fuera del menú
         * @param {Object} playlist - Objeto playlist con id y name
         * @param {HTMLElement} anchorEl - Botón de 3 puntos que sirve de referencia de posición
         */
        function showPlaylistContextMenu(playlist, anchorEl) {
            // Cerrar menú existente si hay uno abierto
            if (_plCtxMenu) { _plCtxMenu.remove(); _plCtxMenu = null; }

            const menu = document.createElement('div');
            menu.className = 'pl-context-menu';
            menu.innerHTML = `
                <div class="pl-context-menu-item" data-action="open">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
                    <span>Abrir playlist</span>
                </div>
                <div class="pl-context-menu-item danger" data-action="delete">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4h-3.5z"/></svg>
                    <span>Eliminar playlist</span>
                </div>
            `;
            document.body.appendChild(menu);
            _plCtxMenu = menu;

            // Posicionar cerca del botón de 3 puntos
            const rect = anchorEl.getBoundingClientRect();
            let top = rect.bottom + 4;
            let left = rect.left - menu.offsetWidth + rect.width;
            if (top + 120 > window.innerHeight) top = rect.top - 120;
            if (left < 8) left = 8;
            menu.style.top  = top  + 'px';
            menu.style.left = left + 'px';

            menu.querySelector('[data-action="open"]').addEventListener('click', () => {
                menu.remove(); _plCtxMenu = null;
                loadAndDisplayPlaylist(playlist.id, playlist.name);
            });
            menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
                menu.remove(); _plCtxMenu = null;
                deletePlaylist(playlist.id);
            });

            // Cerrar al hacer clic fuera
            setTimeout(() => {
                document.addEventListener('click', function onOutside(e) {
                    if (!menu.contains(e.target)) {
                        menu.remove(); _plCtxMenu = null;
                        document.removeEventListener('click', onOutside);
                    }
                });
            }, 0);
        }

        /**
         * Renderiza la lista de playlists en la barra lateral
         * Siempre incluye "Canciones que te gustan" como primer ítem fijo
         * Cada playlist tiene su portada, nombre, botón de 3 puntos y animación "Now Playing"
         * Si no hay playlists, muestra tarjetas de estado vacío con botones de acción
         * @param {Array} playlists - Array de objetos playlist del usuario
         */
        function displayPlaylists(playlists) {
            const playlistsList = document.getElementById('playlistsList');
            if (!playlistsList) return;
            playlistsList.innerHTML = '';

            const likedItem = document.createElement('div');
            likedItem.className = 'playlist-item';
            likedItem.dataset.name = 'Canciones que te gustan';
            likedItem.innerHTML = `
                <div class="sidebar-pl-liked-cover">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="#ffffff" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </div>
                <div class="sidebar-pl-info">
                    <div class="sidebar-pl-name">Canciones que te gustan</div>
                    <div class="sidebar-pl-meta">Lista de reproduccion</div>
                </div>
                <div class="sidebar-pl-now-playing">
                    <div class="sidebar-pl-bar"></div>
                    <div class="sidebar-pl-bar"></div>
                    <div class="sidebar-pl-bar"></div>
                </div>
            `;
            likedItem.addEventListener('click', () => openLikedSongsView());
            playlistsList.appendChild(likedItem);

            playlists.forEach(playlist => {
                const playlistItem = document.createElement('div');
                playlistItem.className = 'playlist-item';
                playlistItem.dataset.id = playlist.id;
                playlistItem.dataset.name = playlist.name;

                // Botón de 3 puntos
                const moreBtn = document.createElement('button');
                moreBtn.className = 'sidebar-pl-more-btn';
                moreBtn.title = 'Más opciones';
                moreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><circle fill="currentColor" cx="12" cy="5" r="2"/><circle fill="currentColor" cx="12" cy="12" r="2"/><circle fill="currentColor" cx="12" cy="19" r="2"/></svg>`;
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showPlaylistContextMenu(playlist, moreBtn);
                });

                playlistItem.innerHTML = `
                    <img src="${getPlaylistCover(playlist)}" alt="${playlist.name}" class="sidebar-pl-cover">
                    <div class="sidebar-pl-info">
                        <div class="sidebar-pl-name">${playlist.name}</div>
                        <div class="sidebar-pl-meta">Lista de reproduccion</div>
                    </div>
                    <div class="sidebar-pl-now-playing">
                        <div class="sidebar-pl-bar"></div>
                        <div class="sidebar-pl-bar"></div>
                        <div class="sidebar-pl-bar"></div>
                    </div>
                `;
                playlistItem.appendChild(moreBtn);
                playlistItem.addEventListener('click', () => loadAndDisplayPlaylist(playlist.id, playlist.name));
                playlistsList.appendChild(playlistItem);
            });

            if (playlists.length === 0) {
                const emptyCards = document.createElement('div');
                emptyCards.className = 'sidebar-lib-empty-cards';
                emptyCards.innerHTML = `
                    <div class="sidebar-lib-empty-card">
                        <h4>Crea tu primera lista</h4>
                        <p>Es muy facil, te lo prometemos.</p>
                        <button class="sidebar-lib-empty-btn" id="libEmptyCreateBtn">Crear lista</button>
                    </div>
                    <div class="sidebar-lib-empty-card">
                        <h4>Descubre nueva musica</h4>
                        <p>Busca artistas, generos y canciones que te gusten.</p>
                        <button class="sidebar-lib-empty-btn" id="libEmptyExploreBtn">Explorar</button>
                    </div>
                `;
                playlistsList.appendChild(emptyCards);
                document.getElementById('libEmptyCreateBtn')?.addEventListener('click', () => {
                    document.getElementById('createPlaylistBtn')?.click();
                });
                document.getElementById('libEmptyExploreBtn')?.addEventListener('click', () => {
                    showSearchView();
                });
            }
        }

        /**
         * Filtra los ítems de la sidebar mostrando solo los que coinciden con la búsqueda
         * Oculta ítems que no contienen el texto buscado en su nombre
         * @param {string} query - Texto a buscar (vacío = mostrar todos)
         */
        function filterSidebarPlaylists(query) {
            const items = document.querySelectorAll('#playlistsList .playlist-item');
            const q = query.trim().toLowerCase();
            items.forEach(item => {
                const name = (item.dataset.name || '').toLowerCase();
                item.classList.toggle('hidden', q.length > 0 && !name.includes(q));
            });
        }

        /**
         * Renderiza la vista de biblioteca (página principal de playlists)
         * Muestra una cuadrícula con: "Canciones que te gustan" + todas las playlists del usuario
         * Cada tarjeta tiene portada, nombre, botón de reproducción y menú de opciones
         * @param {Array} playlists - Array de objetos playlist del usuario
         */
        function displayLibrary(playlists) {
            const libraryGrid = document.getElementById('libraryGrid');
            if (!libraryGrid) return;
            libraryGrid.innerHTML = '';

            const likedList = getLikedSongsPlaylist();
            const likedCard = document.createElement('div');
            likedCard.className = 'playlist-card liked-songs-card';
            likedCard.innerHTML = `
                <div class="pl-card-cover">
                    <div class="liked-songs-cover">
                        <svg viewBox="0 0 24 24" width="48" height="48">
                            <path fill="#ffffff" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                    </div>
                    <button class="pl-card-play" title="Reproducir">
                        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="#000" d="M8 5v14l11-7z"/></svg>
                    </button>
                </div>
                <div class="pl-card-info">
                    <div class="pl-card-name">Canciones que te gustan</div>
                    <div class="pl-card-meta">Lista de reproduccion . ${likedList.length} canciones</div>
                </div>
            `;
            likedCard.addEventListener('click', (e) => {
                if (!e.target.closest('.pl-card-play')) openLikedSongsView();
            });
            likedCard.querySelector('.pl-card-play').addEventListener('click', (e) => {
                e.stopPropagation();
                const songs = getLikedSongsPlaylist();
                const queueSongs = dedupeSongsByTitle(songs);
                if (queueSongs.length) {
                    setPlaylistState(queueSongs);
                    playSongAtIndex(0);
                }
            });
            libraryGrid.appendChild(likedCard);

            playlists.forEach(playlist => {
                const card = document.createElement('div');
                card.className = 'playlist-card';
                const coverSrc = getPlaylistCover(playlist);
                card.innerHTML = `
                    <div class="pl-card-cover">
                        <img src="${coverSrc}" alt="${playlist.name}" style="width:100%;height:100%;object-fit:cover;display:block;">
                        <button class="pl-card-play" title="Reproducir">
                            <svg viewBox="0 0 24 24" width="24" height="24"><path fill="#000" d="M8 5v14l11-7z"/></svg>
                        </button>
                    </div>
                    <div class="pl-card-info">
                        <div class="pl-card-name">${playlist.name}</div>
                        <div class="pl-card-meta">Lista de reproduccion</div>
                    </div>
                    <button class="delete-playlist-btn" title="Eliminar playlist">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                `;
                card.addEventListener('click', (e) => {
                    if (!e.target.closest('.delete-playlist-btn') && !e.target.closest('.pl-card-play')) {
                        loadAndDisplayPlaylist(playlist.id, playlist.name);
                    }
                });
                card.querySelector('.pl-card-play').addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadAndDisplayPlaylist(playlist.id, playlist.name);
                });
                card.querySelector('.delete-playlist-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deletePlaylist(playlist.id);
                });
                libraryGrid.appendChild(card);
            });
        }

        async function loadLibrary() {
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    alert('Debes iniciar sesion para ver tu biblioteca.');
                    window.location.href = 'login.html';
                    return;
                }

                const response = await fetchImpl('/user-playlists', {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                const { data: result, raw } = await readJsonResponse(response);
                if (!response.ok) {
                    throw new Error((result && (result.error || result.message)) || raw || `HTTP ${response.status}`);
                }
                if (!result) {
                    throw new Error('Respuesta invalida del servidor');
                }
                if (result.playlists) {
                    displayLibrary(result.playlists);
                    displayPlaylists(result.playlists);
                } else {
                    document.getElementById('libraryGrid').innerHTML = '<p>No tienes playlists aun. Crea una nueva para empezar.</p>';
                }
            } catch (error) {
                console.error('Error loading library:', error);
                document.getElementById('libraryGrid').innerHTML = '<p>Error al cargar la biblioteca.</p>';
            }
        }

        async function deletePlaylist(playlistId) {
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    alert('Debes iniciar sesion para eliminar playlists.');
                    window.location.href = 'login.html';
                    return;
                }
                const response = await fetchImpl('/delete-playlist', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ playlist_id: playlistId }),
                });
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        loadLibrary();
                    } else {
                        alert('Error al eliminar la playlist: ' + result.message);
                    }
                } else {
                    const errorText = await response.text();
                    alert('Error al eliminar la playlist: ' + errorText);
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Error al procesar la solicitud.');
            }
        }

        return {
            openCreatePlaylistModal,
            closeCreatePlaylistModal,
            createPlaylist,
            loadAndDisplayPlaylist,
            displayPlaylists,
            filterSidebarPlaylists,
            displayLibrary,
            loadLibrary,
            deletePlaylist,
        };
    }

    window.EsplotifyPlaylists = {
        createPlaylistsModule,
    };
})();
