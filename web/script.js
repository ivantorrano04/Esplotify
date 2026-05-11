/**
 * ========================================
 * SCRIPT PRINCIPAL - Orquestador de Esplotify
 * ========================================
 * Propósito: Coordina todos los módulos y gestiona la lógica central del reproductor
 * 
 * Responsabilidades:
 * - Reproducción de audio (playSongAtIndex)
 * - Gestión de la cola automática
 * - Coordinación entre todos los módulos
 * - Manejo de eventos del reproductor
 * - Auto-fill de cola con canciones relacionadas
 * - Inicialización de la aplicación
 * 
 * Módulos coordinados (14):
 * - utils, api, storage, auth, likes, playlists, search, queue
 * - ui, views, results, right-panel, player-controls, home
 */

// ========================================
// VARIABLES GLOBALES - Estado del Reproductor
// ========================================

// Streaming de audio sin cache para reproducción en línea
let currentAudio = null;          // Elemento <audio> actual
// Global player state
let playlist = [];                // Cola de reproducción (array de canciones)
let currentIndex = -1;            // Índice de la canción actual en la cola
let currentSong = null;           // Objeto de la canción actualmente reproduciéndose
let isLoading = false;            // Flag de carga (previene clics múltiples)
let currentVolume = 0.5;          // Volumen actual (0.0 - 1.0)
// ...existing code...

// ========================================
// IMPORTACIÓN DE UTILIDADES
// ========================================
// Import utilities from global modules
const {
    readJsonResponse,         // Parse seguro de JSON
    normalizeSongTitle,       // Normaliza títulos para comparación
    formatDuration,           // Convierte segundos a "m:ss"
    dedupeSongsByTitle,       // Elimina canciones duplicadas
    isTooLong,                // Filtra canciones >7 minutos
    titleAlreadySeen,         // Detecta títulos similares
} = window.EsplotifyUtils;

// ========================================
// ELEMENTOS DEL DOM - Referencias HTML
// ========================================

// ─────────────── DOM Elements ──────────────────────────────

// Search view elements (Vista de búsqueda)
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');

// Player control elements (referenced by module)
// Controles del reproductor principal
const volumeBtn = document.getElementById('volBtn');
const volumeBar = document.getElementById('volumeBar');
const volumeFill = document.getElementById('volumeFill');
const volumeThumb = document.getElementById('volumeThumb');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const progressContainer = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const progressTooltip = document.getElementById('progressTooltip');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');

// Like functionality (Sistema de favoritos)
let likedSongs = [];              // Array de IDs de canciones favoritas
const likeBtn = document.getElementById('playerLikeBtn');

// Recently played functionality (Historial de reproducción)
let recentlyPlayed = [];          // Array de canciones reproducidas recientemente

// ========================================
// MÓDULO DE COLA - Inicialización
// ========================================
// Variables para auto-queue (cola automática de canciones relacionadas)
let _autoQueueRequestId = 0;      // ID de petición para invalidar búsquedas antiguas
let _autoQueueInFlightSeed = null; // Semilla de la búsqueda en progreso
const { createQueueModule } = window.EsplotifyQueue;
const {
    addSongToQueueUnique,         // Añade canción sin duplicar
    setQueueAndPlayFromSongs,     // Establece cola y reproduce
} = createQueueModule({
    getPlaylist: () => playlist,
    setPlaylist: (nextPlaylist) => {
        playlist = nextPlaylist;
    },
    playSongAtIndex: (index) => window.playSongAtIndex(index), // Wrapper para resolver en runtime
    normalizeSongTitle,
});

// ========================================
// PARÁMETROS DE URL Y UTILIDADES
// ========================================
// Check for artist parameter in URL
const urlParams = new URLSearchParams(window.location.search);
const artistParam = urlParams.get('artist');

/**
 * Verifica si un token JWT ha expirado
 * @param {string} token - Token JWT a verificar
 * @returns {boolean} True si el token expiró
 */
// Function to check if JWT token is expired
function isTokenExpired(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const exp = payload.exp;
        const now = Date.now() / 1000;
        return exp < now;
    } catch (e) {
        return true;
    }
}

// ========================================
// MÓDULO DE API - Inicialización
// ========================================
const {
    fetchLikedSongs,              // GET /liked-songs
    saveLikedSong,                // POST/DELETE /liked-songs
    fetchRecentlyPlayed,          // GET /recently-played
    saveRecentlyPlayed,           // POST /recently-played
    fetchAutoGeneratedPlaylists,  // GET /auto-playlists
    saveAutoGeneratedPlaylist,    // POST /auto-playlists
    getOrCreatePlaylist,          // Obtiene o crea playlist
} = window.EsplotifyApi;

// ========================================
// MÓDULO DE STORAGE - Inicialización
// ========================================
const { createStorageModule } = window.EsplotifyStorage;
const {
    saveLikedSongs,               // Guarda favoritos en localStorage
    getLikedSongsPlaylist,        // Obtiene playlist de favoritos
    saveLikedSongsPlaylist,       // Guarda playlist de favoritos
    saveMadeForYouPlaylists,      // Guarda playlists automáticas
    loadMadeForYouPlaylists,      // Carga playlists automáticas
    madeForYouKey: MADE_FOR_YOU_KEY, // Clave para localStorage
} = createStorageModule({
    getLikedSongs: () => likedSongs,
});
const { createAuthModule } = window.EsplotifyAuth;
const {
    isLoggedIn,
    boot: bootAuth,
} = createAuthModule({
    madeForYouKey: MADE_FOR_YOU_KEY,
    initRightPanel: () => window._initRightPanel && window._initRightPanel(),
});
const { createPlaylistsModule } = window.EsplotifyPlaylists;
const {
    openCreatePlaylistModal,
    closeCreatePlaylistModal,
    createPlaylist,
    loadAndDisplayPlaylist,
    displayPlaylists,
    filterSidebarPlaylists,
    displayLibrary,
    loadLibrary,
    deletePlaylist,
} = createPlaylistsModule({
    readJsonResponse,
    prefetchSongs: (songs) => prefetchSongs(songs),
    displayPlaylistView: (...args) => window.displayPlaylistView(...args),
    showLibraryView: () => window.showLibraryView(),
    showSearchView: () => window.showSearchView(),
    openLikedSongsView: () => window.openLikedSongsView(),
    getPlaylistCover: (...args) => window._getPlaylistCover(...args),
    getLikedSongsPlaylist: () => getLikedSongsPlaylist(),
    dedupeSongsByTitle,
    getPlaylistState: () => playlist,
    setPlaylistState: (nextPlaylist) => {
        playlist = nextPlaylist;
    },
    playSongAtIndex: (index) => window.playSongAtIndex(index),
    fetchImpl: fetch,
});
window.deletePlaylist = deletePlaylist;
// Bug 3 fix: exponer funciones del modal en window para que los onclick del HTML funcionen
window.closeCreatePlaylistModal = closeCreatePlaylistModal;
window.openCreatePlaylistModal = openCreatePlaylistModal;

// Sincroniza una auto-playlist al backend DB (fire-and-forget seguro)
// Con debounce de 2s por playlist para evitar llamadas en r\u00e1faga
const _syncAutoDebounceTimers = {};
function syncAutoPlaylistToDB(playlist) {
    if (!isLoggedIn()) return;
    const key = playlist.id || 'unknown';
    clearTimeout(_syncAutoDebounceTimers[key]);
    _syncAutoDebounceTimers[key] = setTimeout(() => {
        saveAutoGeneratedPlaylist(playlist).catch(e =>
            console.error('[sync] Error guardando auto-playlist en DB:', e)
        );
    }, 2000);
}


// Disable browser back/forward navigation completely
window.history.pushState(null, null, window.location.href);
window.addEventListener('popstate', (event) => {
    window.history.pushState(null, null, window.location.href);
});
const { createLikesModule } = window.EsplotifyLikes;
const {
    toggleLike,
    isLiked,
    updateLikeButton,
    toggleLikeSong,
} = createLikesModule({
    state: {
        getLikedSongs: () => likedSongs,
        setLikedSongs: (nextLikedSongs) => {
            likedSongs = nextLikedSongs;
        },
        getCurrentSong: () => currentSong,
    },
    deps: {
        likeBtn,
        saveLikedSong,
        saveLikedSongs,
        getLikedSongsPlaylist,
        saveLikedSongsPlaylist,
    },
});
const { createUiModule } = window.EsplotifyUi;
const {
    buildSongActions,
    showSongContextMenu,
    showToast,
    getPlaylistCover,
    prefetchSongs,
    initUiBindings,
} = createUiModule({
    isLiked,
    toggleLikeSong,
    addSongToQueueUnique,
    getCurrentIndex: () => currentIndex,
    getPlaylist: () => playlist,
    setPlaylist: (nextPlaylist) => {
        playlist = nextPlaylist;
    },
    openArtistPage: (artistName) => window.openArtistPage(artistName),
    getCurrentSong: () => currentSong,
    setCurrentSong: (nextSong) => {
        currentSong = nextSong;
    },
    openAddToPlaylistModal: (...args) => window.openAddToPlaylistModal(...args),
    filterSidebarPlaylists,
    openCreatePlaylistModal,
    showHomeView: () => window.showHomeView(),
    showSearchView,
    fetchImpl: fetch,
});
window._getPlaylistCover = getPlaylistCover; // Make available for playlists module
window._showSongContextMenu = (e, song) => showSongContextMenu(e, song); // Bug B fix: exponer para views.js
window._showToast = (msg) => showToast(msg); // Exponer showToast para uso global
initUiBindings();

// Right Panel module wiring (after all dependencies are available)
const { createRightPanelModule } = window.EsplotifyRightPanel;
const rightPanel = createRightPanelModule({
    getCurrentSong: () => currentSong,
    getPlaylist: () => playlist,
    getCurrentIndex: () => currentIndex,
    getCurrentAudio: () => currentAudio,
    getLikedSongs: () => likedSongs,
    setLikedSongs: (next) => { likedSongs = next; },
    isLoading: () => isLoading,
    setIsLoading: (v) => { isLoading = v; },
    formatDuration,
    openSongContextMenu: showSongContextMenu,
    playSongAtIndex: (index) => window.playSongAtIndex(index),
    toggleLike,
    loadMadeForYouPlaylists,
    saveMadeForYouPlaylists,
    fetchImpl: fetch,
    normalizeSongTitle,
    prefetchSongs,
});
const initRightPanel = rightPanel.initRightPanel;
window._initRightPanel = initRightPanel; // Make available for auth module
const updateLyrics = rightPanel.updateLyrics;
const highlightCurrentLyric = rightPanel.highlightCurrentLyric;
const scrollToLyric = rightPanel.scrollToLyric;

const { createViewsModule } = window.EsplotifyViews;
const {
    loadUserData,
    setupInitialDataLoad,
    openArtistPage,
    openAlbumView,
    loadArtistPage,
    displayAlbumView,
    displayArtistProfile,
} = createViewsModule({
    state: {
        getLikedSongs: () => likedSongs,
        setLikedSongs: (nextLikedSongs) => {
            likedSongs = nextLikedSongs;
        },
        getRecentlyPlayed: () => recentlyPlayed,
        setRecentlyPlayed: (nextRecentlyPlayed) => {
            recentlyPlayed = nextRecentlyPlayed;
        },
        getCurrentSong: () => currentSong,
    },
    deps: {
        artistParam,
        resultsDiv,
        loadingDiv,
        errorDiv,
        readJsonResponse,
        formatDuration,
        fetchImpl: fetch,
        showSearchView,
        showHomeView,
        populateHomeCards: () => window._populateHomeCards && window._populateHomeCards(),
        prefetchSongs,
        setQueueAndPlayFromSongs,
        toggleLikeSong,
        loadPlaylists,
        saveMadeForYouPlaylists,
        saveLikedSongs,
        saveLikedSongsPlaylist,
        updateLikeButton,
        fetchRecentlyPlayed,
        fetchLikedSongs,
        fetchAutoGeneratedPlaylists,
    },
});
// Bug 4 fix: exponer openArtistPage en window para que ui.js lo pueda resolver
window.openArtistPage = openArtistPage;

// Results module - must be created before search module
const { createResultsModule } = window.EsplotifyResults;
const {
    displayResults: displayResultsImpl,
} = createResultsModule({
    resultsDiv,
    formatDuration,
    buildSongActions,
    setQueueAndPlayFromSongs,
    openAlbumView: (id, title, thumb) => openAlbumView(id, title, thumb),
    prefetchSongs,
});
_displayResultsImpl = displayResultsImpl;

// Search state and constants
const SearchState = {
    clientCache: new Map(),
    selectionLockUntil: 0,
    pendingRender: null,
    timeoutId: null,
    requestSeq: 0,       // Secuencia para invalidar búsquedas antiguas
    lastQuery: '',       // Última query buscada (para filtrado local)
    lastData: null,      // Últimos resultados (para filtrado local sin fetch)
    activeController: null, // AbortController de la búsqueda en vuelo
};

const SEARCH_CLICK_LOCK_MS = 300;
const SEARCH_CLIENT_CACHE_TTL_MS = 60000;
const SEARCH_INPUT_DEBOUNCE_MS = 300; // Delay antes de lanzar la búsqueda

// Search module wiring - created after results module
const { createSearchModule } = window.EsplotifySearch;
const {
    attachResultInteractionLocks,
    searchSongs,
    cancelInFlightSearch,
} = createSearchModule({
    state: SearchState,
    constants: {
        SEARCH_CLICK_LOCK_MS,
        SEARCH_CLIENT_CACHE_TTL_MS,
    },
    deps: {
        searchInput,
        resultsDiv,
        loadingDiv,
        errorDiv,
        displayResults: displayResultsImpl,
        fetchImpl: fetch,
    },
});

setupInitialDataLoad();


likeBtn.addEventListener('click', () => {
    if (currentSong) {
        toggleLike(currentSong);
        updateLikeButton();
    }
});

async function updateStoredRecientesPlaylist() {
    try {
        let playlistId = localStorage.getItem('recientesPlaylistId');
        if (!playlistId) {
            // Create the playlist if it doesn't exist
            playlistId = await getOrCreatePlaylist('Recientes');
            if (playlistId) {
                localStorage.setItem('recientesPlaylistId', playlistId);
            } else {
                console.error('Failed to create Recientes playlist');
                return;
            }
        }
        // Update the playlist with new songs
        const token = localStorage.getItem('token');
        if (!token) return;
        const response = await fetch('/replace-playlist-songs', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ playlist_id: playlistId, songs: recentlyPlayed.slice() })
        });
        if (!response.ok) {
            const text = await response.text().catch(()=>'');
            console.error('Failed to update Recientes playlist', response.status, text);
        }
    } catch (e) {
        console.error('Error updating stored recientes playlist:', e);
    }
}

// =============================================
// SONG ACTIONS "” Heart + 3-dot context menu
// =============================================

attachResultInteractionLocks();

// Update playing row/card highlight
function updatePlayingRow() {
    document.querySelectorAll('.song-row, .song-card, .song-table-row, .popular-song-item, .album-track-row').forEach(el => {
        el.classList.remove('playing');
    });
    const currentEl = document.querySelector(`[data-index="${currentIndex}"]`);
    if (currentEl) {
        currentEl.classList.add('playing');
    }
}

// Player Controls module wiring
const { createPlayerControlsModule } = window.EsplotifyPlayerControls;
const playerControls = createPlayerControlsModule({
    getCurrentAudio: () => currentAudio,
    setCurrentAudio: (audio) => { currentAudio = audio; },
    getCurrentSong: () => currentSong,
    setCurrentSong: (song) => { currentSong = song; },
    getPlaylist: () => playlist,
    getCurrentIndex: () => currentIndex,
    setCurrentIndex: (idx) => { currentIndex = idx; },
    isLoading: () => isLoading,
    setIsLoading: (v) => { isLoading = v; },
    getRecentlyPlayed: () => recentlyPlayed,
    setRecentlyPlayed: (rp) => { recentlyPlayed = rp; },
    formatDuration,
    saveRecentlyPlayed,
    updateStoredRecientesPlaylist,
    updateLikeButton,
    openAddToPlaylistModal,
    updatePlayingRow,
    updateLyrics,
    normalizeSongTitle,
});

const updatePlayPauseIcon = playerControls.updatePlayPauseIcon;
const updateProgress = playerControls.updateProgress;
const setupAudioListeners = playerControls.setupAudioListeners;
const nextSong = playerControls.nextSong;
const prevSong = playerControls.prevSong;

playerControls.initControls();

// Home module wiring
const { createHomeModule } = window.EsplotifyHome;
const homeModule = createHomeModule({
    getRecentlyPlayed: () => recentlyPlayed,
    getLikedSongsPlaylist,
    getPlaylist: () => playlist,
    setPlaylist: (nextPlaylist) => { playlist = nextPlaylist; },
    playSongAtIndex: (index) => window.playSongAtIndex(index),
    getCurrentIndex: () => currentIndex,
    loadMadeForYouPlaylists,
    saveMadeForYouPlaylists,
    syncAutoPlaylistToDB,
    formatDuration,
    normalizeSongTitle,
    dedupeSongsByTitle,
    buildSongActions,
    openArtistPage,
    openAlbumView,
    openLikedSongsView,
    showSearchView,
    displayPlaylistView,
    setQueueAndPlayFromSongs,
    fetchImpl: fetch,
});

const populateHomeCards = homeModule.populateHomeCards;
window._populateHomeCards = populateHomeCards; // Make available for views module
const refreshDiscoveryNow = homeModule.refreshDiscoveryNow;
const openPlaylistFromHome = homeModule.openPlaylistFromHome;

// Buscar al escribir con debounce integrado en home
searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    const clearBtn = document.getElementById('clearSearchBtn');
    const genreTiles = document.getElementById('genreTiles');
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
    if (genreTiles) genreTiles.style.display = val ? 'none' : 'block';
    clearTimeout(SearchState.timeoutId);
    if (!val.trim()) {
        cancelInFlightSearch();
        SearchState.pendingRender = null;
        // Volver al home cuando se borra la búsqueda
        resultsDiv.innerHTML = '';
        document.getElementById('homeView').style.display = 'block';
        document.getElementById('searchView').style.display = 'none';
        updateNavActiveState('home');
        return;
    }
    // Mostrar searchView inmediatamente mientras esperamos resultados
    document.getElementById('homeView').style.display = 'none';
    document.getElementById('searchView').style.display = 'block';
    updateNavActiveState('search');
    SearchState.timeoutId = setTimeout(() => {
        searchSongs(val, { preserveResults: true });
    }, SEARCH_INPUT_DEBOUNCE_MS);
});

// Home/recommendations generation handled by home module

// Truncar título a máximo 6 palabras
function truncateTitle(title) {
    if (!title) return 'Canción desconocida';
    const words = title.split(' ');
    if (words.length <= 6) return title;
    return words.slice(0, 6).join(' ') + '...';
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTypingField = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
    );
    if (isTypingField) return;

    if (e.code === 'Space' && currentAudio) {
        e.preventDefault();
        playPauseBtn.click();
    }
});

// Volume control and player controls are handled by player-controls module

// ========================================
// COLA AUTOMÁTICA - Auto-Fill Inteligente
// ========================================
/**
 * Genera automáticamente una cola de canciones relacionadas
 * 
 * Estrategia:
 * 1. Detecta el género de la canción (por palabras clave en título/artista)
 * 2. Si no detecta género, infiere por caracteres españoles o artistas latinos conocidos
 * 3. Busca en 2 categorías:
 *    - Canciones del mismo artista
 *    - Canciones del mismo género o artistas similares
 * 4. Filtra covers (canciones con palabras clave del título en otra versión)
 * 5. Prioriza canciones del mismo artista (peso x3)
 * 6. Elimina duplicados y canciones ya en la cola
 * 7. Limita a 30 canciones nuevas máximo
 * 8. Añade las canciones a la cola sin duplicar
 * 
 * @param {Object} song - Canción actual que sirve de semilla
 */
// ─── Auto-fill related queue when playing from search ───────────────────────
async function autoFillRelatedQueue(song) {
    if (!song || !song.author) return;
    
    const requestId = ++_autoQueueRequestId;  // ID de petición para invalidar búsquedas antiguas
    const author = song.author;
    const currentId = song.id;
    const currentTitleKey = normalizeSongTitle(song.title);

    // Detecta género por palabras clave en título + artista
    const _genreHints = ['reggaeton','pop','rock','trap','hip hop','r&b','latin','indie','electronic',
        'dance','house','soul','jazz','classical','folk','metal','punk','country','flamenco',
        'bachata','salsa','cumbia','urban','alternative','emo','drill'];
    const _titleLower = (song.title + ' ' + author).toLowerCase();
    let _detectedGenre = _genreHints.find(g => _titleLower.includes(g)) || '';

    // Si no se detectó género, infiere por caracteres españoles o artistas latinos conocidos
    // Esto detecta artistas como Quevedo, Bad Bunny, Bizarrap, etc.
    if (!_detectedGenre) {
        const _spanishChars = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(song.title + author);
        const _knownLatinArtists = /quevedo|bad bunny|bizarrap|feid|karol g|rauw|anuel|ozuna|maluma|j balvin|myke towers|jhay cortez|wisin|daddy yankee|nicki nicole|morad|c\.? ?tangana|pablo alboran|rosali|peso pluma|natanael cano|junior h|nodal|ivan cornejo/i.test(author);
        if (_spanishChars || _knownLatinArtists) {
            _detectedGenre = 'reggaeton latin urban';
        }
    }

    // Filtro de covers: extrae palabras clave del título (no stopwords ni nombre del artista)
    const _stop = new Set([
        'the','a','an','ft','feat','featuring','vs','and','de','el','la','en','con',
        'official','video','audio','lyrics','remix','cover','version','remaster','live',
        'acoustic','music'
    ]);
    const _authorWords = new Set(
        author.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
    );
    const _songKeys = song.title.toLowerCase()
        .replace(/[^\w\s]/g, ' ').split(/\s+/)
        .filter(w => w.length >= 3 && !_stop.has(w) && !_authorWords.has(w));

    /**
     * Detecta si una canción es un cover de la actual
     * @param {Object} s - Canción a evaluar
     * @returns {boolean} True si comparte 2+ palabras clave con el título original
     */
    function _isCover(s) {
        if (_songKeys.length === 0) return false;
        const t = s.title.toLowerCase().replace(/[^\w\s]/g, ' ');
        const hits = _songKeys.filter(w => t.includes(w)).length;
        return hits >= Math.min(2, _songKeys.length);
    }

    /**
     * Búsqueda con timeout de 7 segundos para evitar estancamientos
     * @param {string} query - Query de búsqueda
     * @param {number} timeoutMs - Timeout en milisegundos
     * @returns {Promise<Object>} Resultados de búsqueda o {} si falla
     */
    // Search helper with timeout so blocked requests do not stall queue generation.
    async function safeSearch(query, timeoutMs = 7000) {
        if (!query) return {};
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
            if (!res.ok) return {};
            return await res.json();
        } catch (_) {
            return {};
        } finally {
            clearTimeout(timer);
        }
    }

    // Construye la query de género; si está vacía usa búsqueda amplia del artista
    const genreQuery = _detectedGenre
        ? `${_detectedGenre} hits`
        : `${author} similar artists mix`;

    // Realiza 2 búsquedas en paralelo: artista y género
    let artistData = {}, genreData = {};
    const searches = [safeSearch(author)];
    if (genreQuery) searches.push(safeSearch(genreQuery));
    const settled = await Promise.allSettled(searches);
    
    // Verifica que la petición no fue invalidada mientras esperaba
    if (requestId !== _autoQueueRequestId) return;
    if (settled[0] && settled[0].status === 'fulfilled') artistData = settled[0].value || {};
    if (settled[1] && settled[1].status === 'fulfilled') genreData = settled[1].value || {};

    // Construye Set de IDs y títulos ya vistos (incluye la canción actual y toda la cola)
    const seen = new Set([currentId]);
    const seenTitles = new Set(currentTitleKey ? [currentTitleKey] : []);
    // Semilla con todas las canciones en la cola para nunca readir nada que ya esté
    for (const s of playlist) {
        if (!s) continue;
        const k = normalizeSongTitle(s.title);
        if (k) seenTitles.add(k);
        if (s.id) seen.add(s.id);
    }

    /**
     * Extrae todas las canciones de las categorías Canciones y Podcasts
     * @param {Object} data - Datos de búsqueda categorizados
     * @returns {Array} Array de canciones
     */
    function extractSongs(data) {
        return [
            ...(data['Canciones'] || []),
            ...(data['Podcasts o Recopilaciones'] || [])
        ];
    }

    // Collect artist songs (up to 12, skip >7 min and similar titles)
    const artistSongs = [];
    for (const s of extractSongs(artistData)) {
        const titleKey = normalizeSongTitle(s.title);
        if (!seen.has(s.id) && titleKey && !titleAlreadySeen(titleKey, seenTitles) && !_isCover(s) && !isTooLong(s)) {
            seen.add(s.id);
            seenTitles.add(titleKey);
            artistSongs.push(s);
        }
        if (artistSongs.length >= 12) break;
    }

    // Collect genre songs (up to 10, skip same author, skip >7 min and similar titles)
    const genreSongs = [];
    for (const s of extractSongs(genreData)) {
        const titleKey = normalizeSongTitle(s.title);
        if (!seen.has(s.id) && titleKey && !titleAlreadySeen(titleKey, seenTitles) && s.author !== author && !isTooLong(s)) {
            seen.add(s.id);
            seenTitles.add(titleKey);
            genreSongs.push(s);
        }
        if (genreSongs.length >= 10) break;
    }

    // Interleave: 2 artist songs, 1 genre song, repeat
    const related = [];
    const aQ = [...artistSongs];
    const gQ = [...genreSongs];
    while (aQ.length > 0 || gQ.length > 0) {
        if (aQ.length) related.push(aQ.shift());
        if (aQ.length) related.push(aQ.shift());
        if (gQ.length) related.push(gQ.shift());
    }

    // Fallback: pull same-author songs from recently played if queue is still short.
    // We intentionally do NOT fall back to unrelated songs from previous sessions.
    if (related.length < 8) {
        for (const s of recentlyPlayed || []) {
            if (!s || !s.id || s.author !== author) continue;
            const key = normalizeSongTitle(s.title);
            if (!key || titleAlreadySeen(key, seenTitles) || isTooLong(s)) continue;
            seenTitles.add(key);
            related.push(s);
            if (related.length >= 18) break;
        }
    }

    if (requestId !== _autoQueueRequestId) return;

    // If we found nothing, keep current queue untouched.
    if (related.length === 0) return;

    // Shuffle lightly (swap neighbours randomly)
    for (let i = related.length - 1; i > 1; i--) {
        const j = Math.floor(Math.random() * i);
        [related[i], related[j]] = [related[j], related[i]];
    }

    // Replace upcoming queue only when we have a valid replacement set.
    if (currentIndex >= 0 && currentIndex < playlist.length) {
        playlist.splice(currentIndex + 1);
    }
    related.forEach(s => addSongToQueueUnique(s));

    if (typeof window._rpRenderQueue === 'function') window._rpRenderQueue();
    if (typeof window._rpRenderNowPlaying === 'function') window._rpRenderNowPlaying();
}


// ─── Right Panel (Queue + Lyrics) ─────────────────────────────────────────
// ...right panel logic moved to right-panel.js...

bootAuth();



async function addSongToPlaylist(playlistId) {
    if (!currentSong) return;
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Debes iniciar sesión para añadir canciones a playlists.');
            window.location.href = 'login.html';
            return;
        }
        const songPayload = {
            id: currentSong.id,
            title: currentSong.title || '',
            author: currentSong.author || '',
            duration: currentSong.duration || 0,
            thumbnail: currentSong.thumbnail || ''
        };
        const payload = {
            playlist_id: playlistId,
            song: songPayload
        };
        console.log("Enviando a playlist:", payload);
        const response = await fetch('/add-to-playlist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const { data: result, raw } = await readJsonResponse(response);
        console.log("Status HTTP:", response.status);
        console.log("Respuesta del backend:", result);
        if (response.ok) {
            alert('Canción añadida a la playlist exitosamente.');
            closeAddToPlaylistModal();
        } else {
            alert('Error al añadir la canción: ' + ((result && (result.error || result.message)) || raw || `HTTP ${response.status}`));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al procesar la solicitud.');
    }
}

// â”€â”€â”€ Add To Playlist Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function openAddToPlaylistModal(trigger) {
    if (!currentSong) return;
    const modal   = document.getElementById('addToPlaylistModal');
    const popover = document.getElementById('atpPopover');
    const listEl  = document.getElementById('playlistsSelection');
    const searchInput = document.getElementById('playlistSearchInput');
    if (!modal || !popover || !listEl) return;

    // Position popover near the trigger button
    let triggerEl = null;
    try {
        if (trigger instanceof Event) triggerEl = trigger.currentTarget || trigger.target;
        else if (trigger instanceof Element) triggerEl = trigger;
    } catch (_) {}

    // Reset position to centered default
    popover.classList.remove('positioned');
    popover.style.left = '';
    popover.style.top  = '';
    popover.style.transform = '';

    const token = localStorage.getItem('token');
    if (!token) {
        alert('Debes iniciar sesión para añadir canciones a playlists.');
        window.location.href = 'login.html';
        return;
    }

    // Show modal centered on screen (Spotify-style dialog)
    modal.classList.add('show');

    // Fetch playlists
    const renderList = (playlists, filter) => {
        listEl.innerHTML = '';

        // â”€â”€ Nueva playlist â”€â”€
        const newRow = document.createElement('div');
        newRow.className = 'atp-new-playlist';
        newRow.innerHTML = `
            <div class="atp-new-icon">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M11 11V7h2v4h4v2h-4v4h-2v-4H7v-2h4z"/></svg>
            </div>
            <span class="atp-new-label">Nueva lista de reproducción</span>
        `;
        newRow.addEventListener('click', () => {
            closeAddToPlaylistModal();
            document.getElementById('createPlaylistBtn')?.click();
        });
        listEl.appendChild(newRow);

        if (!playlists || playlists.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'atp-empty';
            empty.textContent = 'No tienes listas aún.';
            listEl.appendChild(empty);
            return;
        }

        const q = (filter || '').toLowerCase().trim();
        const filtered = q ? playlists.filter(p => (p.name || '').toLowerCase().includes(q)) : playlists;

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'atp-empty';
            empty.textContent = 'Sin resultados.';
            listEl.appendChild(empty);
            return;
        }

        filtered.forEach(pl => {
            const row = document.createElement('div');
            row.className = 'atp-item';
            row.innerHTML = `
                <img src="${getPlaylistCover(pl)}" alt="${pl.name}" class="atp-item-cover">
                <span class="atp-item-name">${pl.name}</span>
                <svg class="atp-item-check" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
            `;
            row.addEventListener('click', () => addSongToPlaylist(pl.id));
            listEl.appendChild(row);
        });
    };

    try {
        const res    = await fetch('/user-playlists', { headers: { 'Authorization': `Bearer ${token}` } });
        const { data: result, raw } = await readJsonResponse(res);
        if (!res.ok) {
            throw new Error((result && (result.error || result.message)) || raw || `HTTP ${res.status}`);
        }
        const playlists = Array.isArray(result.playlists) ? result.playlists : [];
        modal._playlists = playlists;
        renderList(playlists, '');
    } catch (e) {
        listEl.innerHTML = `<div class="atp-empty">Error al cargar las listas. ${e && e.message ? e.message : ''}</div>`;
    }

    // Search handler
    if (searchInput) {
        searchInput.value = '';
        if (modal._searchHandler) searchInput.removeEventListener('input', modal._searchHandler);
        let debounce = null;
        modal._searchHandler = (e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => renderList(modal._playlists, e.target.value), 200);
        };
        searchInput.addEventListener('input', modal._searchHandler);
        setTimeout(() => searchInput.focus(), 50);
    }

    // ESC to close
    const onKey = (e) => { if (e.key === 'Escape') closeAddToPlaylistModal(); };
    document.addEventListener('keydown', onKey);
    modal._onKeyDown = onKey;
}

function closeAddToPlaylistModal() {
    const modal   = document.getElementById('addToPlaylistModal');
    const popover = document.getElementById('atpPopover');
    if (!modal) return;
    modal.classList.remove('show');
    if (popover) { popover.classList.remove('positioned'); popover.style.cssText = ''; }
    if (modal._onKeyDown) { document.removeEventListener('keydown', modal._onKeyDown); delete modal._onKeyDown; }
    const si = document.getElementById('playlistSearchInput');
    if (si && modal._searchHandler) { si.removeEventListener('input', modal._searchHandler); delete modal._searchHandler; }
    delete modal._playlists;
}
// ========================================
// FUNCIÓN PRINCIPAL DE REPRODUCCIÓN
// ========================================
/**
 * Reproduce una canción en el índice especificado de la playlist
 * 
 * Proceso completo:
 * 1. Valida índice y previene doble carga
 * 2. Pausa y limpia el audio anterior
 * 3. Actualiza UI (thumbnail, título, artista)
 * 4. Crea nuevo elemento Audio con streaming
 * 5. Configura event listeners (canplay, loadedmetadata, play, pause, timeupdate, ended)
 * 6. Inicia reproducción automática
 * 7. Actualiza favoritos, historial, letra y estadísticas
 * 8. Dispara auto-queue si queda poco contenido
 * 
 * @param {number} index - Índice de la canción en la playlist global
 */
// Reproducir canción por índice en playlist con streaming en línea
window.playSongAtIndex = async function playSongAtIndex(index) {
    // Validaciones iniciales
    if (index < 0 || index >= playlist.length || isLoading) return;
    
    currentIndex = index;
    updatePlayingRow();
    const song = playlist[index];
    isLoading = true;
    
    try {
        // Pausa y limpia el audio anterior
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        
        // Actualiza la UI del reproductor
        playerThumbnail.src = song.thumbnail;
        playerTitle.textContent = truncateTitle(song.title);
        playerAuthor.textContent = song.author;
        
        // Hace el nombre del artista clickeable para navegar a su página
        playerAuthor.style.cursor = 'pointer';
        playerAuthor.style.textDecoration = 'underline';
        playerAuthor.onclick = () => {
            const currentParams = new URLSearchParams(window.location.search);
            const currentArtist = currentParams.get('artist');
            if (currentArtist === song.author) return;
            const newUrl = `${window.location.pathname}?artist=${encodeURIComponent(song.author)}`;
            window.history.pushState({ artist: song.author }, '', newUrl);
            loadArtistPage(song.author);
        };
        
        // Muestra el reproductor y resetea la barra de progreso
        player.classList.add('show');
        progressFill.style.width = '0%';
        currentTimeEl.textContent = '0:00';
        durationEl.textContent = '0:00';
        
        updatePlayPauseIcon(); // Muestra icono de pausa mientras carga
        
        // Crea nuevo elemento Audio para streaming
        currentAudio = new Audio();
        currentAudio.preload = 'auto';
        currentAudio.volume = currentVolume; // Aplica el volumen actual
        currentAudio.src = `/audio?id=${song.id}`;
        
        // Event: cuando el audio está listo para reproducirse
        currentAudio.addEventListener('canplay', () => {
            if (!currentAudio.paused) return; // Ya está reproduciéndose
            currentAudio.play().catch((error) => {
                console.error('Error playing audio:', error);
                updatePlayPauseIcon();
            });
        }, { once: true });
        
        // Event: cuando se cargan los metadatos (duración)
        currentAudio.addEventListener('loadedmetadata', () => {
            durationEl.textContent = formatDuration(Math.floor(currentAudio.duration));
            // Actualiza estadísticas del panel "Now Playing"
            if (typeof window._rpRefreshNowPlayingStats === 'function') {
                window._rpRefreshNowPlayingStats();
            }
        });
        
        // Event: cuando comienza la reproducción
        currentAudio.addEventListener('play', () => {
            isLoading = false;
            updatePlayPauseIcon();
            updatePlayingRow();
            if (typeof window._rpRefreshNowPlayingStats === 'function') {
                window._rpRefreshNowPlayingStats();
            }
        });
        currentAudio.addEventListener('pause', () => {
            isLoading = false;
            updatePlayPauseIcon();
            updatePlayingRow();
            if (typeof window._rpRefreshNowPlayingStats === 'function') {
                window._rpRefreshNowPlayingStats();
            }
        });
        currentAudio.addEventListener('timeupdate', () => {
            updateProgress();
            if (isLyricsPanelOpen) {
                updateLyrics(currentAudio.currentTime);
            }
            if (typeof window._rpRefreshNowPlayingStats === 'function') {
                window._rpRefreshNowPlayingStats();
            }
        });
        currentAudio.addEventListener('ended', () => {
            isLoading = false;
            updatePlayPauseIcon();
            updatePlayingRow();
            if (typeof window._rpRefreshNowPlayingStats === 'function') {
                window._rpRefreshNowPlayingStats();
            }
            nextSong();
        });
        currentAudio.addEventListener('error', (e) => {
            isLoading = false;
            console.error('Error de audio:', e);
            // Si la URL redirigida expiró, intentar con un nuevo src
            alert('Error al reproducir la canción. Intenta con otra.');
            player.classList.remove('show');
            updatePlayPauseIcon();
            updatePlayingRow();
        });
        // Iniciar carga inmediatamente
        currentAudio.load();
        currentSong = {
            id: song.id,
            title: song.title,
            author: song.author,
            thumbnail: song.thumbnail,
            duration: song.duration || 0
        };
        // Add to recently played
        const existingIndex = recentlyPlayed.findIndex(s => s.id === song.id);
        if (existingIndex > -1) {
            recentlyPlayed.splice(existingIndex, 1);
        }
    recentlyPlayed.unshift(song);
    if (recentlyPlayed.length > 20) recentlyPlayed.splice(20);
    saveRecentlyPlayed(song);
    // Mantener persistencia en "Hecho para ti" -> Recientes
    updateStoredRecientesPlaylist();
        updateLikeButton();
        const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
        if (currentSong) {
            addToPlaylistBtn.style.display = 'block';
            // replace any previous handler to avoid duplicate listeners
            addToPlaylistBtn.onclick = (ev) => openAddToPlaylistModal(addToPlaylistBtn);
        } else {
            addToPlaylistBtn.style.display = 'none';
            addToPlaylistBtn.onclick = null;
        }
    } catch (err) {
        isLoading = false;
        console.error('Error:', err);
        alert('Error al cargar la canción');
        updatePlayPauseIcon();
    }
}

function displayPlaylistView(playlistData) {
    const { playlistName, songs, owner, playlistId } = playlistData;
    const playlistView = document.getElementById('playlistView');
    const playlistCoverImg = document.getElementById('playlistCoverImg');
    const playlistTitle = document.getElementById('playlistTitle');
    const playlistSongsList = document.getElementById('playlistSongsList');

    // Limpiar contenido anterior
    playlistView.innerHTML = '';

    // Obtener la imagen de fondo (primera canción o cover por defecto)
    const backgroundImage = songs.length > 0 ? songs[0].thumbnail : '';

    // Crear header difuminado como en la vista de artista
    const playlistHeader = document.createElement('div');
    playlistHeader.className = 'artist-header-large';
    playlistHeader.style.backgroundImage = `url(${backgroundImage})`;
    playlistHeader.innerHTML = `
        <div class="artist-header-overlay"></div>
        <div class="artist-header-content">
            <div class="artist-verified">
                <svg viewBox="0 0 24 24" width="24" height="24">
                    <path fill="#1DB954" d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V21C3 22.11 3.89 23 5 23H19C20.11 23 21 22.11 21 21V9M19 9H14V4H19V9Z"/>
                </svg>
                Lista de reproducción
            </div>
            <h1 class="artist-name-large">${playlistName.toUpperCase()}</h1>
            <p class="artist-listeners">${songs.length} canciones "¢ Creada por ${owner || 'Tú'}</p>
        </div>
    `;

    // Crear barra de control como en la vista de artista
    const controlBar = document.createElement('div');
    controlBar.className = 'artist-control-bar';
    controlBar.innerHTML = `
        <button class="play-all-btn">
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
        </button>
        <img src="${backgroundImage}" alt="Playlist cover" class="album-cover-small">
        <button class="shuffle-btn">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M17 3l4 4-4 4V7h-4V5h4V3zM7 21l-4-4 4-4v3h4v2H7v3zM17 17l4-4-4-4v3h-4v2h4v3zM7 7l-4 4 4 4V8h4V6H7V7z" fill="currentColor"/></svg>
        </button>
        <button class="follow-btn">Editar</button>
        <button class="menu-btn">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/></svg>
        </button>
    `;

    // Wire play-all button to play the playlist immediately
    setTimeout(() => {
        const playAllBtn = controlBar.querySelector('.play-all-btn');
        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                if (!Array.isArray(songs) || songs.length === 0) return;
                playlist = dedupeSongsByTitle(songs);
                playSongAtIndex(0);
            });
        }
    }, 0);

    // Crear sección de canciones populares
    const mainContent = document.createElement('div');
    mainContent.className = 'artist-main-content';

    const popularSection = document.createElement('div');
    popularSection.className = 'popular-songs';
    const plTitle = document.createElement('h2');
    plTitle.textContent = 'Canciones';
    popularSection.appendChild(plTitle);
    const plList = document.createElement('div');
    plList.className = 'popular-list';
    songs.forEach((song, index) => {
        const globalIndex = index;
        const row = document.createElement('div');
        row.className = 'popular-song-item';
        row.setAttribute('data-index', globalIndex);
        row.innerHTML = `
            <div class="song-num-cell">
                <span class="song-num-label">${index + 1}</span>
                <svg class="song-num-play" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            </div>
            <img src="${song.thumbnail}" alt="${song.title}" class="song-thumbnail-small">
            <div class="song-info">
                <div class="song-title">${song.title}</div>
                <div class="song-meta">
                    <span class="explicit-label">E</span>
                    <span class="play-count">${song.author}</span>
                </div>
            </div>
            <div class="song-duration">${formatDuration(song.duration)}</div>
        `;
        const rowActions = buildSongActions(song);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-song-btn';
        removeBtn.title = 'Eliminar de la lista';
        removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
        removeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!playlistId) return;
            const token = localStorage.getItem('token');
            if (!token) return;
            try {
                const res = await fetch('/remove-from-playlist', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ playlist_id: playlistId, song_id: song.id }),
                });
                if (res.ok) {
                    row.remove(); // Quitar la fila del DOM inmediatamente
                } else {
                    const err = await res.json().catch(() => ({}));
                    if (typeof window._showToast === 'function') window._showToast('Error al eliminar: ' + (err.error || res.status));
                }
            } catch (err) {
                console.error('Error eliminando canción de playlist:', err);
                if (typeof window._showToast === 'function') window._showToast('Error al eliminar la canción');
            }
        });
        rowActions.appendChild(removeBtn);
        row.appendChild(rowActions);
        row.addEventListener('click', (e) => {
            if (!e.target.closest('.song-actions')) setQueueAndPlayFromSongs(songs, song);
        });
        plList.appendChild(row);
    });
    popularSection.appendChild(plList);

    // Agregar secciones al contenedor principal
    playlistView.appendChild(playlistHeader);
    playlistView.appendChild(controlBar);
    playlistView.appendChild(mainContent);
    mainContent.appendChild(popularSection);

    // Mostrar la vista de playlist y ocultar lo demás
    document.getElementById('searchView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    const homeViewEl = document.getElementById('homeView');
    if (homeViewEl) homeViewEl.style.display = 'none';
    playlistView.style.display = 'block';
}
// Show library view function
async function openLikedSongsView() {
    // Recargar desde servidor para tener datos frescos
    const token = localStorage.getItem('token');
    let songs = getLikedSongsPlaylist(); // inicio rápido con caché local

    if (token) {
        try {
            const raw = await fetchLikedSongs();
            if (Array.isArray(raw) && raw.length > 0) {
                songs = raw.map(r => ({
                    id: r.song_id ?? r.id ?? '',
                    title: r.song_title ?? r.title ?? 'Canción desconocida',
                    author: r.song_author ?? r.author ?? 'Desconocido',
                    duration: r.song_duration ?? r.duration ?? 0,
                    thumbnail: (r.song_thumbnail ?? r.thumbnail ?? '') || ''
                })).filter(s => s.id);
                saveLikedSongsPlaylist(songs);
                likedSongs = songs.map(s => s.id);
            }
        } catch (e) { console.error('Error refreshing liked songs:', e); }
    }

    const playlistView = document.getElementById('playlistView');
    playlistView.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'artist-header-large liked-songs-header';
    header.innerHTML = `
        <div class="artist-header-overlay"></div>
        <div class="artist-header-content">
            <div class="liked-songs-header-icon">
                <svg viewBox="0 0 24 24" width="72" height="72">
                    <path fill="#ffffff" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            </div>
            <div class="artist-header-text">
                <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Lista de reproducción</div>
                <h1 class="artist-name-large" style="font-size:clamp(32px,5vw,80px);">Canciones que te gustan</h1>
                <p class="artist-listeners">${songs.length} canciones guardadas</p>
            </div>
        </div>
    `;
    playlistView.appendChild(header);

    // Control bar
    const controls = document.createElement('div');
    controls.className = 'artist-control-bar';
    controls.innerHTML = `
        <button class="play-all-btn" title="Reproducir todo">
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
        </button>
        <button class="shuffle-liked-btn" title="Aleatorio">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
    `;
    controls.querySelector('.play-all-btn').addEventListener('click', () => {
        if (songs.length === 0) return;
        playlist = dedupeSongsByTitle(songs);
        playSongAtIndex(0);
    });
    controls.querySelector('.shuffle-liked-btn').addEventListener('click', () => {
        if (songs.length === 0) return;
        const shuffled = [...songs].sort(() => Math.random() - 0.5);
        playlist = dedupeSongsByTitle(shuffled);
        playSongAtIndex(0);
    });
    playlistView.appendChild(controls);

    // Song list
    if (songs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'artist-main-content';
        empty.style.cssText = 'text-align:center;padding:80px 32px;color:#b3b3b3;';
        empty.innerHTML = `
            <svg viewBox="0 0 24 24" width="64" height="64" style="margin-bottom:16px;opacity:0.4;">
                <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <p style="font-size:20px;font-weight:700;color:#fff;margin-bottom:8px;">Aún no tienes canciones guardadas</p>
            <p>Busca canciones y pulsa el corazón para añadirlas aquí.</p>
        `;
        playlistView.appendChild(empty);
    } else {
        const mainContent = document.createElement('div');
        mainContent.className = 'artist-main-content';
        const songSection = document.createElement('div');
        songSection.className = 'popular-songs';
        songSection.style.padding = '0 32px';
        const listEl = document.createElement('div');
        listEl.className = 'popular-list';

        songs.forEach((song, index) => {
            const gIdx = index;
            const row = document.createElement('div');
            row.className = 'popular-song-item';
            row.setAttribute('data-index', gIdx);
            row.innerHTML = `
                <div class="song-num-cell">
                    <span class="song-num-label">${index + 1}</span>
                    <svg class="song-num-play" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
                </div>
                <img src="${song.thumbnail || ''}" alt="${song.title || ''}" class="song-thumbnail-small">
                <div class="song-info">
                    <div class="song-title">${song.title || 'Canción desconocida'}</div>
                    <div class="song-meta"><span class="play-count">${song.author || ''}</span></div>
                </div>
                <div class="song-duration">${formatDuration(song.duration)}</div>
            `;
            row.appendChild(buildSongActions(song));
            row.addEventListener('click', (e) => {
                if (!e.target.closest('.song-actions')) setQueueAndPlayFromSongs(songs, song);
            });
            listEl.appendChild(row);
        });

        songSection.appendChild(listEl);
        mainContent.appendChild(songSection);
        playlistView.appendChild(mainContent);
    }

    // Ocultar vistas y mostrar playlistView
    document.getElementById('homeView').style.display = 'none';
    document.getElementById('searchView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    playlistView.style.display = 'block';
    updateNavActiveState('library');
}

function showLibraryView() {
    document.getElementById('playlistView').style.display = 'none';
    document.getElementById('homeView').style.display = 'none';
    document.getElementById('searchView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'block';
    loadLibrary();
    updateNavActiveState('library');
}

// Show home view function
function showHomeView() {
    // topBarSearch siempre visible "” limpiar cualquier query activo
    searchInput.value = '';
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    clearTimeout(SearchState.timeoutId);

    document.getElementById('playlistView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    document.getElementById('searchView').style.display = 'none';

    const storedPlaylists = loadMadeForYouPlaylists();

    if (!storedPlaylists || storedPlaylists.length === 0) {
        // Solo generar si ya tenemos datos; si no, el async DOMContentLoaded lo hará tras loadUserData
        if (recentlyPlayed.length > 0) {
            const recientesPlaylist = { id: 'recientes', name: 'Recientes', songs: recentlyPlayed.slice(), owner: 'Tú' };
            const newPlaylists = [recientesPlaylist, ...generateRecommendations(recentlyPlayed)];
            saveMadeForYouPlaylists(newPlaylists);
        }
    } else {
        // Hay playlists persistidas: actualizar 'recientes' SOLO si ya hay datos cargados
        if (recentlyPlayed.length > 0) {
            const rpIndex = storedPlaylists.findIndex(p => p.id === 'recientes');
            if (rpIndex > -1) {
                storedPlaylists[rpIndex].songs = recentlyPlayed.slice();
            } else {
                storedPlaylists.unshift({ id: 'recientes', name: 'Recientes', songs: recentlyPlayed.slice(), owner: 'Tú' });
            }
            saveMadeForYouPlaylists(storedPlaylists);
            // Sincronizar 'recientes' actualizado al DB (upsert)
            const recientesUpdated = storedPlaylists.find(p => p.id === 'recientes');
            if (recientesUpdated) syncAutoPlaylistToDB(recientesUpdated);
        }
    }

    const homeView = document.getElementById('homeView');
    if (!homeView) {
        createHomeView();
    } else {
        homeView.style.display = 'block';
        populateHomeCards();
    }
    updateNavActiveState('home');
}

// Show search view function
function showSearchView() {
    document.getElementById('playlistView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    const homeView = document.getElementById('homeView');
    if (homeView) homeView.style.display = 'none';

    document.getElementById('searchView').style.display = 'block';

    // Show genre tiles only if search is empty
    const query = searchInput.value;
    const genreTiles = document.getElementById('genreTiles');
    if (genreTiles) genreTiles.style.display = query ? 'none' : 'block';

    // Build genre tiles on first visit
    buildGenreTiles();

    // Focus the search input
    setTimeout(() => searchInput.focus(), 50);
    updateNavActiveState('search');
}

// Create home view layout
function createHomeView() {
    const mainContent = document.querySelector('.main-content');
    const homeView = document.createElement('div');
    homeView.id = 'homeView';
    homeView.className = 'home-view';
    homeView.innerHTML = `
        <div class="home-header">
            <h1>Buenas tardes</h1>
        </div>
        <div class="home-sections">
            <section class="home-section">
                <h2>Recientemente reproducidas</h2>
                <div class="cards-grid">
                    <!-- Cards will be populated dynamically -->
                </div>
            </section>
            <section class="home-section">
                <h2>Hecho para ti</h2>
                <div class="cards-grid">
                    <!-- Cards will be populated dynamically -->
                </div>
            </section>
            <section class="home-section">
                <h2>Àlbumes populares</h2>
                <div class="cards-grid">
                    <!-- Cards will be populated dynamically -->
                </div>
            </section>
        </div>
    `;
    mainContent.appendChild(homeView);
    populateHomeCards();
}

// Home view management handled by home module

// Update navigation active states
function updateNavActiveState(activeView) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
    });
    if (activeView === 'home') {
        const homeNav = document.getElementById('homeNav');
        if (homeNav) homeNav.classList.add('active');
    } else if (activeView === 'search') {
        const searchNav = document.getElementById('searchNav');
        if (searchNav) searchNav.classList.add('active');
        else {
            const homeNav = document.getElementById('homeNav');
            if (homeNav) homeNav.classList.add('active');
        }
    } else if (activeView === 'library') {
        const libraryNav = document.getElementById('libraryNav');
        if (libraryNav) libraryNav.classList.add('active');
    }
}

// =============================================
// Genre tiles for the search view
// =============================================
const GENRE_TILES = [
    { name: 'Pop',            color: '#E8115B', icon: 'ðŸŽµ' },
    { name: 'Hip-Hop',        color: '#DC148C', icon: 'ðŸŽ¤' },
    { name: 'Rock',           color: '#E91429', icon: 'ðŸŽ¸' },
    { name: 'Dance/Electrónica', color: '#1E3264', icon: 'ðŸŽ§' },
    { name: 'Indie',          color: '#477D95', icon: 'ðŸŽ¶' },
    { name: 'R&B',            color: '#503750', icon: 'ðŸŽ·' },
    { name: 'Latin',          color: '#8C67AC', icon: 'ðŸ’ƒ' },
    { name: 'Country',        color: '#BC5900', icon: 'ðŸ¤ ' },
    { name: 'Reggaetón',      color: '#E61E32', icon: 'ðŸ”¥' },
    { name: 'Jazz',           color: '#0D73EC', icon: 'ðŸŽº' },
    { name: 'Soul',           color: '#27856A', icon: 'ðŸŽ™ï¸' },
    { name: 'Clásica',        color: '#4B917D', icon: 'ðŸŽ»' },
    { name: 'K-Pop',          color: '#8D67AB', icon: 'â­' },
    { name: 'Metal',          color: '#3D3D3D', icon: 'ðŸ¤˜' },
    { name: 'Flamenco',       color: '#B04B00', icon: 'ðŸŒ¹' },
    { name: 'Reggae',         color: '#1DB954', icon: 'ðŸŒ´' },
];

function buildGenreTiles() {
    const grid = document.getElementById('genreGrid');
    if (!grid || grid.children.length > 0) return; // already built
    GENRE_TILES.forEach(genre => {
        const tile = document.createElement('div');
        tile.className = 'genre-tile';
        tile.style.backgroundColor = genre.color;
        tile.innerHTML = `
            <span class="genre-tile-name">${genre.name}</span>
            <span class="genre-tile-note">${genre.icon}</span>
        `;
        tile.addEventListener('click', () => {
            searchInput.value = genre.name;
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.style.display = 'flex';
            const genreTiles = document.getElementById('genreTiles');
            if (genreTiles) genreTiles.style.display = 'none';
            searchSongs(genre.name);
        });
        grid.appendChild(tile);
    });
}

// Event listeners for create playlist modal
document.addEventListener('DOMContentLoaded', () => {
    const createPlaylistBtn = document.getElementById('createPlaylistBtn');
    if (createPlaylistBtn) {
        createPlaylistBtn.addEventListener('click', openCreatePlaylistModal);
    }
    const createPlaylistBtnLibrary = document.getElementById('createPlaylistBtnLibrary');
    if (createPlaylistBtnLibrary) {
        createPlaylistBtnLibrary.addEventListener('click', openCreatePlaylistModal);
    }
    const closeCreatePlaylistModalBtn = document.getElementById('closeCreatePlaylistModal');
    if (closeCreatePlaylistModalBtn) {
        closeCreatePlaylistModalBtn.addEventListener('click', closeCreatePlaylistModal);
    }
    const cancelCreatePlaylistBtn = document.getElementById('cancelCreatePlaylistBtn');
    if (cancelCreatePlaylistBtn) {
        cancelCreatePlaylistBtn.addEventListener('click', closeCreatePlaylistModal);
    }
    const confirmCreatePlaylistBtn = document.getElementById('confirmCreatePlaylistBtn');
    if (confirmCreatePlaylistBtn) {
        confirmCreatePlaylistBtn.addEventListener('click', createPlaylist);
    }
    const libraryNav = document.getElementById('libraryNav');
    if (libraryNav) {
        libraryNav.addEventListener('click', showLibraryView);
    }
    // Search nav item â†’ search view (con genre tiles)
    const searchNavItem = document.getElementById('searchNav');
    if (searchNavItem) {
        searchNavItem.addEventListener('click', (e) => {
            e.preventDefault();
            showSearchView();
        });
    }
    // Add event listeners for Home nav item
    const homeNav = document.querySelector('#homeNav');
    if (homeNav) {
        homeNav.addEventListener('click', (e) => {
            e.preventDefault();
            showHomeView();
        });
    }
    // "Tu biblioteca" title button â†’ library view
    const libTitleBtn = document.querySelector('.sidebar-lib-title-btn');
    if (libTitleBtn) {
        libTitleBtn.addEventListener('click', () => showLibraryView());
    }
    // (Search nav integrated in top-bar and sidebar)

    // Clear search button â†’ volver al home
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            clearTimeout(SearchState.timeoutId);
            cancelInFlightSearch();
            SearchState.pendingRender = null;
            searchInput.value = '';
            clearSearchBtn.style.display = 'none';
            resultsDiv.innerHTML = '';
            const genreTiles = document.getElementById('genreTiles');
            if (genreTiles) genreTiles.style.display = 'block';
            document.getElementById('searchView').style.display = 'none';
            document.getElementById('homeView').style.display = 'block';
            updateNavActiveState('home');
            searchInput.focus();
        });
    }

    loadPlaylists();
    // Initialize with Home view
    showHomeView();
});

// Load playlists on page load
async function loadPlaylists() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const response = await fetch('/user-playlists', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        if (result.playlists) {
            displayPlaylists(result.playlists);
        }
    } catch (error) {
        console.error('Error loading playlists:', error);
    }
}
