// Streaming de audio sin cache para reproducción en línea
let currentAudio = null;
let currentSong = null;
let playlist = [];
let currentIndex = -1;
let isLoading = false;

// Elementos del DOM
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const player = document.getElementById('player');
const playerThumbnail = document.getElementById('playerThumbnail');
const playerTitle = document.getElementById('playerTitle');
const playerAuthor = document.getElementById('playerAuthor');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const progressContainer = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const progressTooltip = document.getElementById('progressTooltip');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');

// Search async coordination (debounce + cancellation + stale response protection)
let searchTimeout = null;
let searchRequestSeq = 0;
let activeSearchController = null;
let searchSelectionLockUntil = 0;
let pendingSearchRender = null;
const SEARCH_INPUT_DEBOUNCE_MS = 180;
const SEARCH_CLICK_LOCK_MS = 700;
const SEARCH_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;
const searchClientCache = new Map(); // key -> { time, data }
let lastSearchQuery = '';
let lastSearchData = null;

function _searchCacheKey(query) {
    return String(query || '').trim().toLowerCase();
}

function _getFreshClientSearch(query) {
    const finalKey = _searchCacheKey(query);
    const hit = searchClientCache.get(finalKey);
    if (!hit) return null;
    if (Date.now() - hit.time > SEARCH_CLIENT_CACHE_TTL_MS) {
        searchClientCache.delete(finalKey);
        return null;
    }
    return hit.data;
}

function _setClientSearch(query, data) {
    const key = _searchCacheKey(query);
    searchClientCache.set(key, { time: Date.now(), data });
    if (searchClientCache.size > 60) {
        // Remove oldest entry to keep memory bounded.
        const oldestKey = searchClientCache.keys().next().value;
        if (oldestKey) searchClientCache.delete(oldestKey);
    }
}

async function readJsonResponse(response) {
    const raw = await response.text();
    let data = null;
    try {
        data = raw ? JSON.parse(raw) : null;
    } catch (_) {
        data = null;
    }
    return { data, raw };
}

function _hasAnySearchResults(categorizedSongs) {
    if (!categorizedSongs) return false;
    return Object.values(categorizedSongs).some(v => Array.isArray(v) && v.length > 0);
}

function _filterCategorizedSearch(categorizedSongs, query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q || !categorizedSongs) return categorizedSongs;

    const filterSongLike = (arr) => (arr || []).filter(s => {
        const t = String((s && s.title) || '').toLowerCase();
        const a = String((s && s.author) || '').toLowerCase();
        return t.includes(q) || a.includes(q);
    }).slice(0, 12);

    const filterAlbumLike = (arr) => (arr || []).filter(a => {
        const t = String((a && a.title) || '').toLowerCase();
        return t.includes(q);
    }).slice(0, 8);

    return {
        'Canciones': filterSongLike(categorizedSongs['Canciones']),
        'Podcasts o Recopilaciones': filterSongLike(categorizedSongs['Podcasts o Recopilaciones']),
        'Albums': filterAlbumLike(categorizedSongs['Albums']),
    };
}

// Volume control elements
const volumeBtn = document.getElementById('volBtn');
const volumeBar = document.getElementById('volumeBar');
const volumeFill = document.getElementById('volumeFill');
const volumeThumb = document.getElementById('volumeThumb');

// Like functionality
let likedSongs = [];
const likeBtn = document.getElementById('playerLikeBtn');

// Recently played functionality
let recentlyPlayed = [];

function normalizeSongTitle(title) {
    return String(title || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
        .replace(/\b(remaster(?:ed)?|live|official|audio|video|lyrics?|lyric|version|mix|edit)\b/g, ' ')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function dedupeSongsByTitle(songs) {
    const out = [];
    const seenTitles = new Set();
    for (const song of (songs || [])) {
        const key = normalizeSongTitle(song && song.title);
        if (!key || seenTitles.has(key)) continue;
        seenTitles.add(key);
        out.push(song);
    }
    return out;
}

const MAX_AUTOFILL_DURATION_S = 420; // 7 minutes — skip longer songs in auto-fill

function isTooLong(song) {
    return song && Number(song.duration) > MAX_AUTOFILL_DURATION_S;
}

// Returns true if titleKey is the same as or meaningfully similar to any entry in seenTitles.
// Similarity: one normalized title is a substring of the other (min 4 chars).
function titleAlreadySeen(titleKey, seenTitles) {
    if (!titleKey) return true;
    if (seenTitles.has(titleKey)) return true;
    if (titleKey.length < 4) return false;
    for (const seen of seenTitles) {
        if (seen.length >= 4 && (seen.includes(titleKey) || titleKey.includes(seen))) return true;
    }
    return false;
}

function addSongToQueueUnique(song, insertAt = null) {
    if (!song) return -1;
    const key = normalizeSongTitle(song.title);
    if (!key) return -1;

    const existingIndex = playlist.findIndex(s => normalizeSongTitle(s && s.title) === key);
    if (existingIndex !== -1) return existingIndex;

    if (Number.isInteger(insertAt) && insertAt >= 0 && insertAt <= playlist.length) {
        playlist.splice(insertAt, 0, song);
        return insertAt;
    }

    playlist.push(song);
    return playlist.length - 1;
}

let _autoQueueRequestId = 0;
let _autoQueueInFlightSeed = null;

function setQueueAndPlayFromSongs(sourceSongs, selectedSong) {
    const selectedKey = normalizeSongTitle(selectedSong && selectedSong.title);
    const selectedId = selectedSong && selectedSong.id;

    const queueSongs = [];
    const keyToIndex = new Map();

    for (const song of (sourceSongs || [])) {
        const key = normalizeSongTitle(song && song.title);
        if (!key) continue;

        if (!keyToIndex.has(key)) {
            keyToIndex.set(key, queueSongs.length);
            queueSongs.push(song);
            continue;
        }

        // If user selected a duplicate-title song, keep that concrete version.
        if (selectedKey && key === selectedKey && selectedId && song && song.id === selectedId) {
            const replaceIdx = keyToIndex.get(key);
            queueSongs[replaceIdx] = song;
        }
    }

    if (!queueSongs.length) return;
    playlist = queueSongs;

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

// Check for artist parameter in URL
const urlParams = new URLSearchParams(window.location.search);
const artistParam = urlParams.get('artist');

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

// Server API functions for user data persistence
async function fetchLikedSongs() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return [];
        const response = await fetch('/liked-songs', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
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

// songOrId: puede ser un objeto completo {id,title,author,...} o solo un string ID
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
            // Pasar metadatos completos para que la BD pueda guardarlos
            const songObj = typeof songOrId === 'object' ? songOrId : { id: songId, title: '', author: '', duration: 0, thumbnail: '' };
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body
        });
        if (!response.ok) throw new Error('Failed to save liked song');
    } catch (error) {
        console.error('Error saving liked song:', error);
    }
}

async function fetchRecentlyPlayed() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return [];
        const response = await fetch('/recently-played', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch recently played');
        const result = await response.json();
        return result.recently_played || [];
    } catch (error) {
        console.error('Error fetching recently played:', error);
        return [];
    }
}

async function saveRecentlyPlayed(song) {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const response = await fetch('/add-recently-played', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
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
            headers: { 'Authorization': `Bearer ${token}` }
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(playlist)
        });
        if (!response.ok) throw new Error('Failed to save auto-generated playlist');
    } catch (error) {
        console.error('Error saving auto-generated playlist:', error);
    }
}

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


// Helper function to get or create playlist by name
async function getOrCreatePlaylist(name) {
    try {
        const token = localStorage.getItem('token');
        if (!token) return null;

        // Fetch user playlists
        const response = await fetch('/user-playlists', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch playlists');
        const result = await response.json();
        const playlists = result.playlists || [];

        // Find existing playlist by name
        const existing = playlists.find(p => p.name === name);
        if (existing) return existing.id;

        // Create new playlist
        const createResponse = await fetch('/create-playlist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
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

// Disable browser back/forward navigation completely
window.history.pushState(null, null, window.location.href);
window.addEventListener('popstate', (event) => {
    window.history.pushState(null, null, window.location.href);
});

// Function to load user data on page load
async function loadUserData() {
    try {
        // Fetch and set recently played songs (normalize fields)
        const recent = await fetchRecentlyPlayed();
        recentlyPlayed = (recent || []).map(r => ({
            id: r.id ?? r.song_id ?? '',
            title: r.title ?? r.song_title ?? 'Canción desconocida',
            author: r.author ?? r.song_author ?? 'Desconocido',
            duration: r.duration ?? r.song_duration ?? 0,
            thumbnail: (r.thumbnail ?? r.song_thumbnail ?? '') || '' ,
            played_at: r.played_at ?? r.playedAt ?? ''
        }));

        // Prefetch las canciones recientes para que estén listas al reproducir
        prefetchSongs(recentlyPlayed);

        // Cargar liked songs desde el servidor (IDs + objetos completos)
        const likedRaw = await fetchLikedSongs();
        if (Array.isArray(likedRaw) && likedRaw.length > 0) {
            // likedRaw contiene objetos con song_id, song_title, etc. (filas de la BD)
            // Normalizar y guardar objetos completos en localStorage
            const likedObjects = likedRaw.map(r => ({
                id: r.song_id ?? r.id ?? '',
                title: r.song_title ?? r.title ?? 'Canción desconocida',
                author: r.song_author ?? r.author ?? 'Desconocido',
                duration: r.song_duration ?? r.duration ?? 0,
                thumbnail: (r.song_thumbnail ?? r.thumbnail ?? '') || ''
            })).filter(s => s.id);
            saveLikedSongsPlaylist(likedObjects);
            // Poblar el array de IDs para isLiked()
            likedSongs = likedObjects.map(s => s.id);
            saveLikedSongs();
        } else {
            // Usuario autenticado sin liked songs en el servidor → limpiar caché del anterior usuario
            saveLikedSongsPlaylist([]);
            likedSongs = [];
            saveLikedSongs();
        }

        // Fetch auto-generated playlists from DB y sincronizar con localStorage
        const autoPlaylists = await fetchAutoGeneratedPlaylists();
        // Filtrar playlists vacías (artefactos de runs anteriores con el bug de recentlyPlayed vacío)
        const validAutoPlaylists = autoPlaylists.filter(p => Array.isArray(p.songs) && p.songs.length > 0);
        if (validAutoPlaylists.length > 0) {
            // Sobrescribir localStorage solo con playlists que tengan canciones reales
            saveMadeForYouPlaylists(validAutoPlaylists);
        }
        // populateHomeCards() se llamará desde el async DOMContentLoaded tras este await

        // Update UI elements that depend on user data
        if (currentSong) {
            updateLikeButton();
        }
    } catch (error) {
        console.error('Error loading user data:', error);
        // Fallback to empty arrays if fetch fails
        likedSongs = [];
        recentlyPlayed = [];
    }
}

// Load artist page if parameter is present, after DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    if (artistParam) {
        loadArtistPage(artistParam);
    }
    // Load user data on page load (recentlyPlayed + auto-playlists desde DB)
    await loadUserData();
    // Ahora que recentlyPlayed está cargado, repoblar la home con datos reales
    // (evita que generateRecommendations corra con recentlyPlayed=[] en el DOMContentLoaded síncrono)
    populateHomeCards();
});

// Navegar a la página de artista (usada desde home, contexto, etc.)
function openArtistPage(artistName) {
    if (!artistName) return;
    loadArtistPage(artistName);
}

// ── Album view ─────────────────────────────────────────────────────────────────
async function openAlbumView(playlistId, title, thumbnail) {
    if (!playlistId) return;
    window._isSearchPlaylist = false;
    showSearchView();
    // Always hide genre tiles when showing an album (they appear when search input is empty)
    const genreTiles = document.getElementById('genreTiles');
    if (genreTiles) genreTiles.style.display = 'none';
    // Save current results so we can go back
    _albumPrevResults = resultsDiv.innerHTML;
    loadingDiv.style.display = 'flex';
    errorDiv.style.display = 'none';
    resultsDiv.innerHTML = '';

    try {
        const res = await fetch(`/album?id=${encodeURIComponent(playlistId)}`);
        const { data, raw } = await readJsonResponse(res);
        if (!res.ok) throw new Error((data && data.error) || raw || `HTTP ${res.status}`);
        if (!data) throw new Error('Respuesta inválida del servidor');
        if (data.error) throw new Error(data.error);
        displayAlbumView(data, thumbnail);
    } catch (err) {
        errorDiv.textContent = 'Error cargando el álbum: ' + err.message;
        errorDiv.style.display = 'block';
    } finally {
        loadingDiv.style.display = 'none';
    }
}

let _albumPrevResults = '';

function displayAlbumView(albumData, fallbackThumb = '') {
    const { id, title, author, trackCount, tracks } = albumData;
    // Use fallbackThumb first (already visible on card), then server thumbnail, then first track
    const thumb = fallbackThumb || albumData.thumbnail || (tracks[0]?.thumbnail) || '';

    const wrap = document.createElement('div');
    wrap.className = 'album-view';

    // Header
    wrap.innerHTML = `
        <div class="album-header">
            <button class="album-back-btn" id="albumBackBtn" aria-label="Volver">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <div class="album-header-body">
                <img class="album-header-img" src="${thumb}" alt="${title}">
                <div class="album-header-info">
                    <p class="album-header-type">Lista de reproducción</p>
                    <h1 class="album-header-title">${title}</h1>
                    <p class="album-header-meta">${author || ''} &nbsp;·&nbsp; ${trackCount} canciones</p>
                </div>
            </div>
        </div>
        <div class="album-control-bar">
            <button class="play-all-btn" id="albumPlayAllBtn" aria-label="Reproducir todo">
                <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="album-save-btn" id="albumSaveBtn" aria-label="Guardar como playlist">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
                Guardar como playlist
            </button>
            <span class="album-save-msg" id="albumSaveMsg"></span>
        </div>
        <div class="album-track-list" id="albumTrackList"></div>
    `;

    // Back button — navigate to the view we came from
    wrap.querySelector('#albumBackBtn').addEventListener('click', () => {
        resultsDiv.innerHTML = '';
        _albumPrevResults = '';
        if (_albumOriginView === 'home') {
            showHomeView();
        } else if (_albumOriginView === 'playlist') {
            document.getElementById('searchView').style.display = 'none';
            document.getElementById('playlistView').style.display = 'block';
        } else {
            // search origin: restore previous results
            resultsDiv.innerHTML = _albumPrevResults;
            // Re-bind album card clicks (HTML is static, events need re-attach)
            resultsDiv.querySelectorAll('.album-card').forEach(card => {
                const playBtn = card.querySelector('.album-card-play');
                const albumId = card.dataset.albumId;
                const albumTitle = card.dataset.albumTitle;
                const albumThumb = card.dataset.albumThumb;
                if (albumId) {
                    playBtn?.addEventListener('click', (e) => { e.stopPropagation(); openAlbumView(albumId, albumTitle, albumThumb); });
                    card.addEventListener('click', () => openAlbumView(albumId, albumTitle, albumThumb));
                }
            });
        }
    });

    // Save button → create playlist + add all tracks
    wrap.querySelector('#albumSaveBtn').addEventListener('click', async () => {
        const token = localStorage.getItem('token');
        if (!token) { alert('Debes iniciar sesión para guardar playlists.'); return; }

        const saveBtn = wrap.querySelector('#albumSaveBtn');
        const saveMsg = wrap.querySelector('#albumSaveMsg');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando…';
        saveMsg.textContent = '';

        try {
            // 1. Create the playlist
            const createRes = await fetch('/create-playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: title })
            });
            const { data: createData, raw: createRaw } = await readJsonResponse(createRes);
            if (!createRes.ok) {
                throw new Error((createData && (createData.error || createData.message)) || createRaw || `HTTP ${createRes.status}`);
            }
            if (!createData) throw new Error('Respuesta inválida al crear playlist');
            if (!createData.success) throw new Error(createData.error || 'No se pudo crear la playlist');

            const playlistId = createData.playlist.id;

            // 2. Add all tracks sequentially
            for (const song of tracks) {
                const addRes = await fetch('/add-to-playlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({
                        playlist_id: playlistId,
                        song: { id: song.id, title: song.title, author: song.author, duration: song.duration, thumbnail: song.thumbnail }
                    })
                });
                if (!addRes.ok) {
                    const { data: addData, raw: addRaw } = await readJsonResponse(addRes);
                    throw new Error((addData && (addData.error || addData.message)) || addRaw || `HTTP ${addRes.status}`);
                }
            }

            saveMsg.textContent = `✓ Guardado en tu biblioteca`;
            saveMsg.style.color = '#1DB954';
            saveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg> Guardado`;
            loadPlaylists();
        } catch (err) {
            saveMsg.textContent = 'Error: ' + err.message;
            saveMsg.style.color = '#f15e6c';
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg> Guardar`;
        }
    });

    // Render tracks
    const listEl = wrap.querySelector('#albumTrackList');
    tracks.forEach((song, i) => {
        const row = document.createElement('div');
        row.className = 'album-track-row';
        row.dataset.index = i;
        row.innerHTML = `
            <div class="album-track-num">
                <span class="album-track-n">${i + 1}</span>
                <svg class="album-track-play-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            </div>
            <img src="${song.thumbnail}" alt="${song.title}" class="album-track-thumb">
            <div class="album-track-info">
                <div class="album-track-title">${song.title}</div>
                <div class="album-track-artist">${song.author}</div>
            </div>
            <span class="album-track-dur">${formatDuration(song.duration)}</span>
        `;
        row.addEventListener('click', () => setQueueAndPlayFromSongs(tracks, song));
        listEl.appendChild(row);
    });

    wrap.querySelector('#albumPlayAllBtn').addEventListener('click', () => {
        setQueueAndPlayFromSongs(tracks, tracks[0]);
    });

    resultsDiv.appendChild(wrap);
    // Scroll to top so album header is the first thing visible
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;
    prefetchSongs(tracks);
}

// Función para cargar la página de artista
async function loadArtistPage(artistName) {
    window._isSearchPlaylist = false;
    try {
        loadingDiv.style.display = 'block';
        errorDiv.style.display = 'none';
        resultsDiv.innerHTML = '';

        const response = await fetch(`/artist?name=${encodeURIComponent(artistName)}`);
        const artistData = await response.json();
        if (artistData.error) {
            throw new Error(artistData.error);
        }
        // Mostrar el perfil del artista en la vista principal de tipo "playlist"
        displayArtistProfile(artistData);
    } catch (err) {
        errorDiv.textContent = 'Error cargando perfil del artista: ' + err.message;
        errorDiv.style.display = 'block';
    } finally {
        loadingDiv.style.display = 'none';
    }
}

// Mostrar perfil del artista
function displayArtistProfile(artistData) {
    const { artist, songs, totalSongs } = artistData;
    const listenersApprox = (songs.length * 847 + 12300).toLocaleString();
    const coverImg = songs.length > 0 ? songs[0].thumbnail : '';

    // â”€â”€ Wrapper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const profileEl = document.createElement('div');
    profileEl.className = 'artist-profile';

    // â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    profileEl.innerHTML = `
        <div class="artist-header-large" style="background-image:url('${coverImg}')">
            <div class="artist-header-overlay"></div>
            <div class="artist-header-content">
                <div class="artist-verified">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="#5c67f2" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                    </svg>
                    Artista verificado
                </div>
                <h1 class="artist-name-large">${artist}</h1>
                <p class="artist-listeners">${listenersApprox} oyentes mensuales</p>
            </div>
        </div>

        <div class="artist-control-bar">
            <button class="play-all-btn" id="artistPlayAllBtn" aria-label="Reproducir">
                <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="artist-action-btn" id="artistFollowBtn">Seguir</button>
            <button class="artist-options-btn" aria-label="Más opciones">
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
                    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                    <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
                </svg>
            </button>
        </div>

        <div class="artist-popular-section">
            <h2>Populares</h2>
            <div class="popular-list" id="artistSongList"></div>
            <button class="artist-see-more" id="artistSeeMore">VER MÀS</button>
        </div>
    `;

    // â”€â”€ Mount songs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const listEl = profileEl.querySelector('#artistSongList');
    const sortedSongs = [...songs].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    let showAll = false;
    const MAX_INITIAL = 5;

    function renderSongs() {
        listEl.innerHTML = '';
        const toShow = showAll ? sortedSongs : sortedSongs.slice(0, MAX_INITIAL);
        toShow.forEach((song, index) => {
            const isLiked = likedSongs.includes(song.id);
            const row = document.createElement('div');
            row.className = 'artist-song-row';
            row.dataset.index = index;
            row.innerHTML = `
                <div class="song-row-num">${index + 1}</div>
                <div class="song-row-play">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                </div>
                <img src="${song.thumbnail}" alt="${song.title}" class="song-row-thumb">
                <div class="song-row-info">
                    <div class="song-row-title">${song.title}</div>
                    <div class="song-row-artist">${song.author ?? artist}</div>
                </div>
                <button class="song-row-like${isLiked ? ' liked' : ''}" data-song-id="${song.id}" aria-label="Me gusta">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                        ${isLiked
                            ? '<path fill="#1DB954" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'
                            : '<path fill="currentColor" d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>'}
                    </svg>
                </button>
                <div class="song-row-duration">${formatDuration(song.duration)}</div>
            `;
            row.querySelector('.song-row-like').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleLikeSong(song);
                renderSongs(); // refresh to update heart state
            });
            row.addEventListener('click', () => setQueueAndPlayFromSongs(sortedSongs, song));
            listEl.appendChild(row);
        });

        const seeMoreBtn = profileEl.querySelector('#artistSeeMore');
        if (sortedSongs.length <= MAX_INITIAL) {
            seeMoreBtn.style.display = 'none';
        } else {
            seeMoreBtn.textContent = showAll ? 'VER MENOS' : 'VER MÀS';
            seeMoreBtn.onclick = () => { showAll = !showAll; renderSongs(); };
        }
    }

    renderSongs();

    // â”€â”€ Play all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    profileEl.querySelector('#artistPlayAllBtn').addEventListener('click', () => {
        setQueueAndPlayFromSongs(sortedSongs, sortedSongs[0]);
    });

    // â”€â”€ Mount view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const playlistView = document.getElementById('playlistView');
    if (!playlistView) return;

    playlistView.innerHTML = '';

    const backBtn = document.createElement('button');
    backBtn.className = 'back-button';
    backBtn.textContent = 'â† Volver';
    backBtn.onclick = () => {
        playlistView.style.display = 'none';
        showHomeView();
    };

    playlistView.appendChild(backBtn);
    playlistView.appendChild(profileEl);

    document.getElementById('searchView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    const homeView = document.getElementById('homeView');
    if (homeView) homeView.style.display = 'none';
    playlistView.style.display = 'block';
}


likeBtn.addEventListener('click', () => {
    if (currentSong) {
        toggleLike(currentSong);
        updateLikeButton();
    }
});

function saveLikedSongs() {
    localStorage.setItem('likedSongs', JSON.stringify(likedSongs));
}


// Key for storing "Hecho para ti" playlists
const MADE_FOR_YOU_KEY = 'madeForYouPlaylists';

// ID fijo para la playlist Descubrimiento Semanal y periodo de refresco (ms)
const DISCOVERY_ID = 'descubrimiento-semanal';
const DISCOVERY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function saveMadeForYouPlaylists(playlists) {
    try {
        localStorage.setItem(MADE_FOR_YOU_KEY, JSON.stringify(playlists));
    } catch (e) {
        console.error('Error saving madeForYouPlaylists:', e);
    }
}

function loadMadeForYouPlaylists() {
    try {
        const raw = localStorage.getItem(MADE_FOR_YOU_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Sanear posibles valores antiguos (p.ej. thumbnail == 'undefined')
        if (Array.isArray(parsed)) {
            parsed.forEach(pl => {
                if (Array.isArray(pl.songs)) {
                    pl.songs = pl.songs.map(s => ({
                        id: s.id ?? s.song_id ?? '',
                        title: s.title ?? s.song_title ?? 'Canción desconocida',
                        author: s.author ?? s.song_author ?? 'Desconocido',
                        duration: s.duration ?? s.song_duration ?? 0,
                        thumbnail: (s.thumbnail ?? s.song_thumbnail ?? '') || ''
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

function toggleLike(song) {
    const index = likedSongs.indexOf(song.id);
    if (index > -1) {
        likedSongs.splice(index, 1);
        saveLikedSong(song.id, 'remove');
    } else {
        likedSongs.push(song.id);
        // Pasar el objeto completo para guardar metadatos en el servidor
        saveLikedSong(song, 'add');
    }
    saveLikedSongs();
    updateLikeButton();
    // Sync all heart buttons for this song across all visible rows
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

function isLiked(songId) {
    return likedSongs.includes(songId);
}


function updateLikeButton() {
    if (!currentSong) return;
    const path = likeBtn.querySelector('path');
    if (path) {
        path.setAttribute('fill', isLiked(currentSong.id) ? '#1DB954' : 'none');
    }
    // Also sync the Now Playing panel like button
    if (typeof window._rpRenderNowPlaying === 'function') window._rpRenderNowPlaying();
}

// =============================================
// SONG ACTIONS "” Heart + 3-dot context menu
// =============================================

// Liked songs playlist local storage key
const LIKED_SONGS_PLAYLIST_KEY = 'likedSongsPlaylist';

function getLikedSongsPlaylist() {
    try {
        const raw = localStorage.getItem(LIKED_SONGS_PLAYLIST_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveLikedSongsPlaylist(songs) {
    localStorage.setItem(LIKED_SONGS_PLAYLIST_KEY, JSON.stringify(songs));
}

function toggleLikeSong(song) {
    const wasLiked = isLiked(song.id);
    // Reuse the existing toggleLike which handles likedSongs array + server sync + button sync
    toggleLike(song);

    // Additionally keep full song objects in the liked songs playlist key
    const playlist_ = getLikedSongsPlaylist();
    if (wasLiked) {
        const i = playlist_.findIndex(s => s.id === song.id);
        if (i > -1) playlist_.splice(i, 1);
    } else {
        if (!playlist_.find(s => s.id === song.id)) playlist_.unshift(song);
    }
    saveLikedSongsPlaylist(playlist_);
}

/**
 * Build the heart + 3-dot action buttons for a song row.
 * Returns a .song-actions div ready to append.
 */
function buildSongActions(song) {
    const wrap = document.createElement('div');
    wrap.className = 'song-actions';

    // â”€â”€ Heart â”€â”€
    const liked = isLiked(song.id);
    const heartBtn = document.createElement('button');
    heartBtn.className = 'song-like-btn' + (liked ? ' liked' : '');
    heartBtn.setAttribute('data-song-id', song.id);
    heartBtn.setAttribute('aria-label', liked ? 'Quitar de canciones que te gustan' : 'Añadir a canciones que te gustan');
    heartBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              fill="${liked ? '#1DB954' : 'none'}"
              stroke="${liked ? '#1DB954' : 'currentColor'}"
              stroke-width="1.5"/>
    </svg>`;
    heartBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLikeSong(song);
    });

    // â”€â”€ 3-dot more â”€â”€
    const moreBtn = document.createElement('button');
    moreBtn.className = 'song-more-btn';
    moreBtn.setAttribute('aria-label', 'Más opciones');
    moreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">
        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/>
    </svg>`;
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showSongContextMenu(e, song);
    });

    wrap.appendChild(heartBtn);
    wrap.appendChild(moreBtn);
    return wrap;
}

// Context menu state
let _scmSong = null;

function showSongContextMenu(e, song) {
    _scmSong = song;
    const menu = document.getElementById('songContextMenu');
    menu.style.display = 'block';

    // Position near cursor, keep in viewport
    const mw = 230, mh = 180;
    let x = e.clientX, y = e.clientY;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    // Update "Añadir/Quitar de likes" label
    const addLikedItem = document.getElementById('scmAddLiked');
    if (addLikedItem) {
        const alreadyLiked = isLiked(song.id);
        addLikedItem.querySelector('span').textContent = alreadyLiked
            ? 'Quitar de canciones que te gustan'
            : 'Añadir a canciones que te gustan';
    }
}

function hideSongContextMenu() {
    document.getElementById('songContextMenu').style.display = 'none';
    _scmSong = null;
}

// Wire context menu items (once DOM is ready)
document.addEventListener('DOMContentLoaded', () => {
    // Close on outside click
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('songContextMenu');
        if (menu && !menu.contains(e.target)) hideSongContextMenu();
    });

    document.getElementById('scmAddToQueue')?.addEventListener('click', () => {
        if (!_scmSong) return;
        const song = _scmSong;
        hideSongContextMenu();
        // Insert right after current song (or at end if nothing playing)
        const insertAt = currentIndex >= 0 ? currentIndex + 1 : playlist.length;
        const idx = addSongToQueueUnique(song, insertAt);
        if (idx === insertAt) {
            showToast(`"${song.title}" añadida a la cola`);
        } else if (idx >= 0) {
            // Bring existing song next in queue to match user intent.
            const [moved] = playlist.splice(idx, 1);
            const target = idx < insertAt ? Math.max(0, insertAt - 1) : insertAt;
            playlist.splice(target, 0, moved);
            showToast(`"${song.title}" movida al inicio de la cola`);
        }
        if (typeof window._rpRenderQueue === 'function') window._rpRenderQueue();
        if (typeof window._rpRenderNowPlaying === 'function') window._rpRenderNowPlaying();
    });

    document.getElementById('scmGoArtist')?.addEventListener('click', () => {
        if (!_scmSong) return;
        hideSongContextMenu();
        openArtistPage(_scmSong.author || '');
    });

    document.getElementById('scmAddToPlaylist')?.addEventListener('click', () => {
        if (!_scmSong) return;
        const songForModal = _scmSong;
        hideSongContextMenu();
        const prev = currentSong;
        currentSong = songForModal;
        openAddToPlaylistModal(null);
        currentSong = prev;
    });

    document.getElementById('scmAddLiked')?.addEventListener('click', () => {
        if (!_scmSong) return;
        toggleLikeSong(_scmSong);
        hideSongContextMenu();
    });

    document.getElementById('scmShare')?.addEventListener('click', () => {
        if (!_scmSong) return;
        const url = `https://music.youtube.com/watch?v=${_scmSong.id}`;
        navigator.clipboard?.writeText(url).then(() => {
            showToast('Enlace copiado al portapapeles');
        });
        hideSongContextMenu();
    });

    // â”€â”€ Library search filter â”€â”€
    const libSearch = document.getElementById('librarySearchInput');
    libSearch?.addEventListener('input', () => {
        const q = libSearch.value.toLowerCase().trim();
        document.querySelectorAll('#libraryGrid .playlist-card').forEach(card => {
            const name = card.querySelector('.pl-card-name')?.textContent.toLowerCase() || '';
            card.style.display = (!q || name.includes(q)) ? '' : 'none';
        });
    });

    // â”€â”€ Library grid/list toggle â”€â”€
    const libToggle = document.getElementById('libViewToggle');
    let _libListView = false;
    const _svgGrid = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/></svg>`;
    const _svgList = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`;
    libToggle?.addEventListener('click', () => {
        _libListView = !_libListView;
        const grid = document.getElementById('libraryGrid');
        if (_libListView) { grid?.classList.add('list-view'); libToggle.innerHTML = _svgGrid; }
        else { grid?.classList.remove('list-view'); libToggle.innerHTML = _svgList; }
    });

    // â”€â”€ Library main filter pills â”€â”€
    document.getElementById('libraryFilterPills')?.addEventListener('click', (e) => {
        const pill = e.target.closest('.lib-filter-pill');
        if (!pill) return;
        document.querySelectorAll('.lib-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
    });

    // â”€â”€ Sidebar filter pills â”€â”€
    document.getElementById('sidebarLibFilters')?.addEventListener('click', (e) => {
        const pill = e.target.closest('.sidebar-lib-pill');
        if (!pill) return;
        document.querySelectorAll('.sidebar-lib-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
    });

    // â”€â”€ Sidebar search within library â”€â”€
    const sidebarLibSearchBtn = document.getElementById('sidebarLibSearchBtn');
    const sidebarLibSearchEl = document.getElementById('sidebarLibSearch');
    const sidebarLibSearchInput = document.getElementById('sidebarLibSearchInput');
    if (sidebarLibSearchBtn && sidebarLibSearchEl && sidebarLibSearchInput) {
        sidebarLibSearchBtn.addEventListener('click', () => {
            const isOpen = sidebarLibSearchEl.classList.toggle('open');
            if (isOpen) sidebarLibSearchInput.focus();
            else { sidebarLibSearchInput.value = ''; filterSidebarPlaylists(''); }
        });
        sidebarLibSearchInput.addEventListener('input', (e) => filterSidebarPlaylists(e.target.value));
        sidebarLibSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                sidebarLibSearchEl.classList.remove('open');
                sidebarLibSearchInput.value = '';
                filterSidebarPlaylists('');
            }
        });
    }

    // â”€â”€ Create playlist shortcut â”€â”€
    document.getElementById('createPlaylistBtn')?.addEventListener('click', () => openCreatePlaylistModal());

    // â”€â”€ Top-bar scroll transparency effect â”€â”€
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

    // â”€â”€ Browse button toggles search view â”€â”€
    document.getElementById('topBrowseBtn')?.addEventListener('click', () => {
        const searchView = document.getElementById('searchView');
        const btn = document.getElementById('topBrowseBtn');
        if (searchView && searchView.style.display !== 'none') {
            // Already in search "” go back home
            btn?.classList.remove('active');
            showHomeView();
        } else {
            btn?.classList.add('active');
            showSearchView();
        }
    });
});


// Simple toast notification
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

// Función para obtener la portada de la playlist
function getPlaylistCover(playlist) {
    if (playlist && playlist.cover) return playlist.cover;
    const name = (playlist && typeof playlist.name === 'string') ? playlist.name : '?';
    const letter = name && name.length > 0 ? name.charAt(0).toUpperCase() : '?';
    const svg = `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" fill="#333"/><text x="20" y="25" font-family="Arial" font-size="20" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

function cancelInFlightSearch() {
    if (activeSearchController) {
        activeSearchController.abort();
        activeSearchController = null;
    }
}

function applyPendingSearchRenderIfNeeded() {
    if (!pendingSearchRender) return;
    if (Date.now() < searchSelectionLockUntil) {
        setTimeout(applyPendingSearchRenderIfNeeded, searchSelectionLockUntil - Date.now() + 15);
        return;
    }

    const { seq, query, data, forceApply } = pendingSearchRender;
    pendingSearchRender = null;

    if (seq !== searchRequestSeq) return;
    if (!forceApply && searchInput && searchInput.value.trim() !== query) return;
    displayResults(data);
}

if (resultsDiv) {
    resultsDiv.addEventListener('pointerdown', () => {
        // Freeze result repaint briefly while user is pressing/clicking an item.
        searchSelectionLockUntil = Date.now() + SEARCH_CLICK_LOCK_MS;
    });
    document.addEventListener('pointerup', () => {
        setTimeout(applyPendingSearchRenderIfNeeded, 0);
    });
}

// Función de búsqueda
async function searchSongs(query, options = {}) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return;

    const preserveResults = options.preserveResults !== false;
    const forceApply = options.forceApply === true;

    const seq = ++searchRequestSeq;
    cancelInFlightSearch();
    const controller = new AbortController();
    activeSearchController = controller;

    loadingDiv.style.display = 'flex';
    errorDiv.style.display = 'none';
    if (!preserveResults) resultsDiv.innerHTML = '';

    // 1) Exact query client cache: instant render.
    const cached = _getFreshClientSearch(normalizedQuery);
    if (cached && _hasAnySearchResults(cached)) {
        displayResults(cached);
        loadingDiv.style.display = 'none';
        return;
    }

    // 2) If user is refining same query, show a quick local filter while network is pending.
    if (lastSearchData && normalizedQuery.toLowerCase().startsWith(lastSearchQuery.toLowerCase()) && lastSearchQuery.length >= 2) {
        const quick = _filterCategorizedSearch(lastSearchData, normalizedQuery);
        if (_hasAnySearchResults(quick)) {
            displayResults(quick);
        }
    }

    try {
        const response = await fetch(`/search?q=${encodeURIComponent(normalizedQuery)}`, {
            signal: controller.signal,
        });
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }

        _setClientSearch(normalizedQuery, data);
        lastSearchQuery = normalizedQuery;
        lastSearchData = data;

        // Ignore stale responses.
        if (seq !== searchRequestSeq) return;
        if (!forceApply && searchInput && searchInput.value.trim() !== normalizedQuery) return;

        if (Date.now() < searchSelectionLockUntil) {
            pendingSearchRender = { seq, query: normalizedQuery, data, forceApply };
            return;
        }

        pendingSearchRender = null;
        displayResults(data);
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        errorDiv.textContent = 'Error al buscar: ' + err.message;
        errorDiv.style.display = 'block';
    } finally {
        if (seq === searchRequestSeq) {
            loadingDiv.style.display = 'none';
        }
    }
}

// Calentar el cache del servidor para una lista de IDs (fire-and-forget)
function prefetchSongs(songs) {
    if (!songs || songs.length === 0) return;
    const ids = songs.slice(0, 5).map(s => s.id || s.song_id).filter(Boolean);
    if (ids.length === 0) return;
    fetch('/prefetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
    }).catch(() => {}); // silenciar errores de red
}

// Mostrar resultados categorizados
function displayResults(categorizedSongs) {
    resultsDiv.innerHTML = '';
    const searchQueue = [];

    function queueSearchSong(song) {
        searchQueue.push(song);
        return searchQueue.length - 1;
    }

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
    const albums    = categorizedSongs['Albums'] || [];
    const otherCategories = Object.entries(categorizedSongs)
        .filter(([k]) => k !== 'Canciones' && k !== 'Albums');
    const hasAny = canciones.length > 0 || albums.length > 0 || otherCategories.some(([, v]) => v.length > 0);

    if (!hasAny) {
        resultsDiv.innerHTML = '<p class="no-results-msg">No se encontraron resultados</p>';
        return;
    }

    // --- Two-column top section: Mejor resultado + Canciones ---
    if (canciones.length > 0) {
        const topSection = document.createElement('div');
        topSection.className = 'search-results-top';

        // LEFT: Mejor resultado card
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
                    <span class="top-result-type-badge">Canción</span>
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

        // RIGHT: Canciones list (next 5 songs)
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
            row.addEventListener('click', (e) => { if (!e.target.closest('.song-actions')) playFromSearchIndex(gIdx); });
            songsList.appendChild(row);
        });
        songsSection.appendChild(songsList);
        topSection.appendChild(songsSection);
        resultsDiv.appendChild(topSection);

        // Remaining songs (beyond the top 6)
        if (canciones.length > 6) {
            const moreSection = document.createElement('div');
            moreSection.className = 'category-section';
            const moreTitle = document.createElement('h2');
            moreTitle.className = 'category-title';
            moreTitle.textContent = 'Más canciones';
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
                row.addEventListener('click', (e) => { if (!e.target.closest('.song-actions')) playFromSearchIndex(gIdx); });
                moreList.appendChild(row);
            });
            moreSection.appendChild(moreList);
            resultsDiv.appendChild(moreSection);
        }
    }

    // Other categories (e.g. Podcasts)
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
            row.addEventListener('click', (e) => { if (!e.target.closest('.song-actions')) playFromSearchIndex(gIdx); });
            songList.appendChild(row);
        });
        section.appendChild(songList);
        resultsDiv.appendChild(section);
    });

    // ── Albums section ────────────────────────────────────────────────────
    if (albums.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'category-section';
        const albumTitle = document.createElement('h2');
        albumTitle.className = 'category-title';
        albumTitle.textContent = 'Álbumes y listas';
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
                    <button class="album-card-play" aria-label="Reproducir álbum">
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

    // Prefetch top songs to reduce playback latency
    const allSongs = [].concat(canciones, ...otherCategories.map(([, v]) => v));
    prefetchSongs(allSongs);
}

// Siguiente canción
function nextSong() {
    if (isRepeated) {
        playSongAtIndex(currentIndex);
    } else if (currentIndex < playlist.length - 1) {
        playSongAtIndex(currentIndex + 1);
    }
}

// Anterior canción con comportamiento de Spotify
let lastPrevPress = 0;
function prevSong() {
    const now = Date.now();
    const timeDiff = now - lastPrevPress;
    if (timeDiff < 500 && currentIndex > 0) {
        playSongAtIndex(currentIndex - 1);
    } else {
        if (currentAudio) {
            currentAudio.currentTime = 0;
            currentAudio.play();
            updatePlayPauseIcon();
        }
    }
    lastPrevPress = now;
}

// Toggle play/pause
playPauseBtn.addEventListener('click', () => {
    if (!currentAudio || isLoading) return;
    if (currentAudio.paused) {
        currentAudio.play();
    } else {
        currentAudio.pause();
    }
    updatePlayPauseIcon();
});

prevBtn.addEventListener('click', prevSong);
nextBtn.addEventListener('click', nextSong);

// Shuffle and repeat buttons
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
let isShuffled = false;
let isRepeated = false;

shuffleBtn.addEventListener('click', () => {
    isShuffled = !isShuffled;
    shuffleBtn.classList.toggle('active', isShuffled);
});

repeatBtn.addEventListener('click', () => {
    isRepeated = !isRepeated;
    repeatBtn.classList.toggle('active', isRepeated);
});

// Actualizar barra de progreso
function updateProgress() {
    if (!currentAudio || isDragging || isSeeking) return;
    const progress = (currentAudio.currentTime / currentAudio.duration) * 100;
    progressFill.style.width = `${progress}%`;
    if (progressThumb) progressThumb.style.left = `${progress}%`;
    currentTimeEl.textContent = formatDuration(Math.floor(currentAudio.currentTime));
}

// Variables para arrastrar
let isDragging = false;
let isSeeking = false;

progressContainer.addEventListener('mousedown', (e) => {
    if (!currentAudio) return;
    isDragging = true;
    updateSeekPosition(e);
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    updateSeekPosition(e);
});

document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const rect = progressContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
    isSeeking = true;
    currentAudio.currentTime = percentage * currentAudio.duration;
    setTimeout(() => { isSeeking = false; }, 100);
});

progressContainer.addEventListener('click', (e) => {
    if (!currentAudio) return;
    const rect = progressContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
    currentAudio.currentTime = percentage * currentAudio.duration;
    progressFill.style.width = `${percentage * 100}%`;
    currentTimeEl.textContent = formatDuration(Math.floor(percentage * currentAudio.duration));
});

progressContainer.addEventListener('mousemove', (e) => {
    if (!currentAudio) return;
    const rect = progressContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
    const time = percentage * currentAudio.duration;
    progressTooltip.textContent = formatDuration(Math.floor(time));
    progressTooltip.style.left = `${mouseX}px`;
    progressTooltip.style.opacity = '1';
});

progressContainer.addEventListener('mouseleave', () => {
    if (!isDragging) {
        progressTooltip.style.opacity = '0';
    }
});

function updateSeekPosition(e) {
    if (!currentAudio) return;
    const rect = progressContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
    progressFill.style.width = `${percentage * 100}%`;
    if (progressThumb) progressThumb.style.left = `${percentage * 100}%`;
    const time = percentage * currentAudio.duration;
    progressTooltip.textContent = formatDuration(Math.floor(time));
    progressTooltip.style.left = `${mouseX}px`;
    progressTooltip.style.opacity = '1';
}

// Buscar al escribir con debounce integrado en home
searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    const clearBtn = document.getElementById('clearSearchBtn');
    const genreTiles = document.getElementById('genreTiles');
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
    if (genreTiles) genreTiles.style.display = val ? 'none' : 'block';
    clearTimeout(searchTimeout);
    if (!val.trim()) {
        cancelInFlightSearch();
        pendingSearchRender = null;
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
    searchTimeout = setTimeout(() => {
        searchSongs(val, { preserveResults: true });
    }, SEARCH_INPUT_DEBOUNCE_MS);
});

// Formatear duración
function formatDuration(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}


// Función para generar recomendaciones basadas en el historial de reproducción
function generateRecommendations(recentlyPlayed) {
    const recommendations = [];

    // Genre preferences saved during onboarding (new users)
    const _savedGenrePrefs = (() => {
        try { return JSON.parse(localStorage.getItem('userGenrePrefs') || 'null'); } catch { return null; }
    })();
    const genrePrefs = Array.isArray(_savedGenrePrefs) && _savedGenrePrefs.length > 0 ? _savedGenrePrefs : null;

    // Analizar patrones en el historial (puede estar vacío para usuarios nuevos)
    const artistCounts = {};
    (recentlyPlayed || []).forEach(song => {
        const artist = (song && song.author) ? song.author : 'Desconocido';
        artistCounts[artist] = (artistCounts[artist] || 0) + 1;
    });

    const allArtists = Object.keys(artistCounts)
        .map(a => (typeof a === 'string' ? a.trim() : ''))
        .filter(a => a && a.toLowerCase() !== 'undefined');

    const topArtists = Object.entries(artistCounts)
        .sort(([,a], [,b]) => b - a)
        .map(([artist]) => artist)
        .slice(0, 3);

    const hasHistory = recentlyPlayed && recentlyPlayed.length > 0;

    // Helpers to update stored MFY playlists and refresh home without full repopulate
    const _updateMFYPlaylist = (id, songs) => {
        const current = loadMadeForYouPlaylists() || [];
        const idx = current.findIndex(p => p.id === id);
        if (idx > -1) { current[idx] = { ...current[idx], songs }; saveMadeForYouPlaylists(current); }
        // Refresh only the slider cards, not the whole home
        const slider = document.getElementById('madeForYouSlider');
        if (slider) {
            const card = slider.querySelector(`[data-pl-id="${id}"]`);
            if (card) {
                const sub = card.querySelector('.sp-card-sub');
                if (sub) sub.textContent = `${songs.length} canciones`;
            }
        }
    };

    // --- Mix Diario — fetch real songs from top artists ---
    const dailyMix = {
        id: 'mix-diario',
        name: hasHistory && topArtists.length > 0 ? `Mix Diario · ${topArtists[0]}` : 'Mix Diario',
        description: hasHistory && topArtists.length > 0
            ? `Basado en ${topArtists.slice(0,3).join(', ')}`
            : 'Escucha canciones para personalizar tu mix',
        songs: [],
        owner: 'Esplotify'
    };

    // Load cached mix first, then refresh async
    const _loadMixDiario = async () => {
        try {
            const stored = loadMadeForYouPlaylists() || [];
            const cached = stored.find(p => p.id === 'mix-diario');
            // Use cached if less than 24h old
            if (cached && Array.isArray(cached.songs) && cached.songs.length >= 5
                && Date.now() - (cached.lastUpdated || 0) < 86400000) {
                dailyMix.songs = cached.songs;
                return;
            }
            // Determine queries: top artists > onboarding genre prefs > generic fallback
            const mixQueries = hasHistory && topArtists.length > 0
                ? topArtists.slice(0, 3)
                : genrePrefs
                    ? genrePrefs.slice(0, 3)
                    : ['pop hits 2025', 'reggaeton hits', 'latin pop 2025'];

            // Sequential searches to avoid rate limiting YouTube
            const songsByArtist = [];
            for (const q of mixQueries) {
                try {
                    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
                    if (!res.ok) { songsByArtist.push([]); continue; }
                    const data = await res.json();
                    const songs = Object.entries(data)
                        .filter(([k]) => k !== 'Albums')
                        .flatMap(([,v]) => v)
                        .slice(0, 8);
                    songsByArtist.push(songs);
                } catch { songsByArtist.push([]); }
                // Small delay between searches to avoid triggering rate limits
                await new Promise(r => setTimeout(r, 400));
            }

            // Deduplicate and shuffle
            const seen = new Set();
            const mixed = [];
            for (const song of songsByArtist.flat().sort(() => Math.random() - 0.5)) {
                if (!seen.has(song.id)) { seen.add(song.id); mixed.push(song); }
                if (mixed.length >= 25) break;
            }

            dailyMix.songs = mixed;
            dailyMix.lastUpdated = Date.now();
            _updateMFYPlaylist('mix-diario', mixed);
            syncAutoPlaylistToDB({ id: 'mix-diario', name: dailyMix.name, description: dailyMix.description, songs: mixed, owner: 'Esplotify' });
            _refreshPlaylistViewIfOpen('mix-diario', mixed);
        } catch(e) { console.error('Mix Diario error:', e); }
    };
    _loadMixDiario();

    // --- Descubrimiento Semanal ---
    const weeklyDiscover = {
        id: DISCOVERY_ID,
        name: 'Descubrimiento Semanal',
        description: hasHistory
            ? 'Nuevas canciones basadas en tu historial de reproducción'
            : 'Escucha canciones para descubrir música nueva',
        songs: [],
        owner: 'Esplotify',
        lastUpdated: 0
    };

    // Solo buscar canciones nuevas si hay historial; si no, dejar vacío hasta que escuche algo
    if (hasHistory) {
        const getUnplayedSongs = async () => {
            try {
                const playedSongIds = new Set((recentlyPlayed || []).map(song => song.id));
                // Limitar a top 3 artistas para evitar loop de búsquedas
                const limitedArtists = topArtists.slice(0, 3);
                // Sequential searches to avoid rate limiting YouTube
                const artistSongs = [];
                for (const artist of limitedArtists) {
                    if (!artist) { artistSongs.push([]); continue; }
                    try {
                        const response = await fetch(`/search?q=${encodeURIComponent(artist)}`);
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        const data = await response.json();
                        artistSongs.push((data.Canciones || []).filter(song => song.author === artist && !playedSongIds.has(song.id)));
                    } catch (error) {
                        console.error(`Error buscando canciones de ${artist}:`, error);
                        artistSongs.push([]);
                    }
                    await new Promise(r => setTimeout(r, 400));
                }
                const allUnplayedSongs = artistSongs.flat();
                const shuffled = allUnplayedSongs.sort(() => Math.random() - 0.5);
                weeklyDiscover.songs = shuffled.slice(0, 50);
                weeklyDiscover.lastUpdated = Date.now();
                const currentPlaylists = loadMadeForYouPlaylists() || [];
                const existingIndex = currentPlaylists.findIndex(pl => pl.id === DISCOVERY_ID);
                if (existingIndex > -1) {
                    currentPlaylists[existingIndex] = { ...currentPlaylists[existingIndex], ...weeklyDiscover };
                } else {
                    currentPlaylists.push(weeklyDiscover);
                }
                saveMadeForYouPlaylists(currentPlaylists);
                populateHomeCards();
                syncAutoPlaylistToDB(weeklyDiscover);
            } catch (error) {
                console.error('Error generando Descubrimiento Semanal:', error);
            }
        };

        (async () => {
            try {
                const stored = loadMadeForYouPlaylists() || [];
                const storedDiscovery = stored.find(p => p.id === DISCOVERY_ID);
                if (storedDiscovery && Array.isArray(storedDiscovery.songs) && storedDiscovery.songs.length > 0) {
                    weeklyDiscover.songs = storedDiscovery.songs;
                    weeklyDiscover.lastUpdated = storedDiscovery.lastUpdated || 0;
                    // Solo refrescar si han pasado más de DISCOVERY_REFRESH_MS Y no está en progreso
                    if (Date.now() - (weeklyDiscover.lastUpdated || 0) > DISCOVERY_REFRESH_MS
                        && !window._discoveryFetchInProgress) {
                        window._discoveryFetchInProgress = true;
                        getUnplayedSongs().finally(() => { window._discoveryFetchInProgress = false; });
                    }
                } else if (!window._discoveryFetchInProgress) {
                    window._discoveryFetchInProgress = true;
                    getUnplayedSongs().finally(() => { window._discoveryFetchInProgress = false; });
                }
            } catch (e) {
                console.error('Error al comprobar Descubrimiento persistido:', e);
                if (!window._discoveryFetchInProgress) {
                    window._discoveryFetchInProgress = true;
                    getUnplayedSongs().finally(() => { window._discoveryFetchInProgress = false; });
                }
            }
        })();
    }

    // --- Radar de Novedades --- fetch tracks from top artists' latest albums ---
    const newReleases = {
        id: 'radar-novedades',
        name: 'Radar de Novedades',
        description: hasHistory
            ? 'Las últimas novedades de tus artistas favoritos'
            : 'Los lanzamientos más populares ahora mismo',
        songs: [],
        owner: 'Esplotify'
    };

    const _loadRadar = async () => {
        try {
            const stored = loadMadeForYouPlaylists() || [];
            const cachedRadar = stored.find(p => p.id === 'radar-novedades');
            // Invalidate old cache if songs have fake 'new-...' IDs from previous implementation
            const hasFakeIds = cachedRadar && (cachedRadar.songs || []).some(s => String(s.id).startsWith('new-'));
            if (!hasFakeIds && cachedRadar && Array.isArray(cachedRadar.songs) && cachedRadar.songs.length >= 3
                && Date.now() - (cachedRadar.lastUpdated || 0) < 43200000) {
                newReleases.songs = cachedRadar.songs;
                return;
            }
            const radarQueries = hasHistory && topArtists.length > 0
                ? topArtists.slice(0, 4)
                : genrePrefs
                    ? genrePrefs.slice(0, 4)
                    : ['top hits 2025', 'pop hits 2025', 'reggaeton 2025', 'latin pop 2025'];
            const seenR = new Set(); const radarSongs = [];
            for (const q of radarQueries) {
                if (radarSongs.length >= 20) break;
                try {
                    const res = await fetch('/search?q=' + encodeURIComponent(q));
                    if (!res.ok) continue;
                    const data = await res.json();
                    const albums = data['Albums'] || [];
                    if (albums.length > 0) {
                        const albumRes = await fetch('/album?id=' + encodeURIComponent(albums[0].id));
                        if (albumRes.ok) {
                            const albumData = await albumRes.json();
                            for (const track of (albumData.tracks || []).slice(0, 6)) {
                                if (!seenR.has(track.id)) { seenR.add(track.id); radarSongs.push(track); }
                            }
                        }
                    } else {
                        const songs = Object.entries(data).filter(([k]) => k !== 'Albums').flatMap(([,v]) => v).slice(0, 5);
                        for (const s of songs) { if (!seenR.has(s.id)) { seenR.add(s.id); radarSongs.push(s); } }
                    }
                } catch(e2) {}
                await new Promise(r => setTimeout(r, 400));
            }
            newReleases.songs = radarSongs;
            newReleases.lastUpdated = Date.now();
            _updateMFYPlaylist('radar-novedades', radarSongs);
            syncAutoPlaylistToDB({ id: 'radar-novedades', name: newReleases.name, description: newReleases.description, songs: radarSongs, owner: 'Esplotify' });
            _refreshPlaylistViewIfOpen('radar-novedades', radarSongs);
        } catch(e) { console.error('Radar error:', e); }
    };
    _loadRadar();

    recommendations.push(dailyMix, weeklyDiscover, newReleases);

    // Sync Descubrimiento Semanal solo si no hay historial (mix/radar sincronizan tras su fetch async)
    if (!hasHistory) syncAutoPlaylistToDB(weeklyDiscover);

    return recommendations;
}

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

// Update play/pause button icon
function updatePlayPauseIcon() {
    const iconPlay = playPauseBtn.querySelector('.icon-play');
    const iconPause = playPauseBtn.querySelector('.icon-pause');
    if (!iconPlay || !iconPause) return;
    if (currentAudio && !currentAudio.paused) {
        iconPlay.style.display = 'none';
        iconPause.style.display = '';
    } else {
        iconPlay.style.display = '';
        iconPause.style.display = 'none';
    }
}

// Update playing row/card highlight
function updatePlayingRow() {
    document.querySelectorAll('.song-row, .song-card, .song-table-row, .popular-song-item').forEach(el => {
        el.classList.remove('playing');
    });
    const currentEl = document.querySelector(`[data-index="${currentIndex}"]`);
    if (currentEl) {
        currentEl.classList.add('playing');
    }
}

updatePlayPauseIcon();

// Volume control functionality
let isVolumeDragging = false;
let currentVolume = 0.7;
if (currentAudio) {
    currentAudio.volume = currentVolume;
    volumeFill.style.width = `${currentVolume * 100}%`;
    if (volumeThumb) volumeThumb.style.left = `${currentVolume * 100}%`;
}
if (volumeFill) volumeFill.style.width = `${currentVolume * 100}%`;
if (volumeThumb) volumeThumb.style.left = `${currentVolume * 100}%`;

volumeBtn.addEventListener('click', () => {
    if (!currentAudio) return;
    if (currentAudio.volume > 0) {
        currentAudio.volume = 0;
        volumeFill.style.width = '0%';
        if (volumeThumb) volumeThumb.style.left = '0%';
        updateVolumeIcon(true);
    } else {
        currentAudio.volume = currentVolume;
        volumeFill.style.width = `${currentVolume * 100}%`;
        if (volumeThumb) volumeThumb.style.left = `${currentVolume * 100}%`;
        updateVolumeIcon(false);
    }
});

volumeBar.addEventListener('click', (e) => {
    if (!currentAudio) return;
    updateVolumePosition(e);
});

volumeBar.addEventListener('mousedown', (e) => {
    if (!currentAudio) return;
    isVolumeDragging = true;
    updateVolumePosition(e);
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isVolumeDragging) return;
    updateVolumePosition(e);
});

document.addEventListener('mouseup', () => {
    isVolumeDragging = false;
});

function updateVolumePosition(e) {
    if (!currentAudio) return;
    const rect = volumeBar.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
    currentAudio.volume = percentage;
    currentVolume = percentage;
    volumeFill.style.width = `${percentage * 100}%`;
    if (volumeThumb) volumeThumb.style.left = `${percentage * 100}%`;
    updateVolumeIcon(percentage === 0);
}

function updateVolumeIcon(isMuted) {
    const icon = volumeBtn.querySelector('svg path');
    const volume = currentAudio ? currentAudio.volume : 0.7;
    if (isMuted || volume === 0) {
        icon.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
    } else if (volume < 0.33) {
        icon.setAttribute('d', 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM12 4L9.91 6.09 12 8.18V4z M4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3z');
    } else if (volume < 0.66) {
        icon.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z');
    } else {
        icon.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z');
    }
}

updateVolumeIcon(false);

// Variables para las letras (globales)
let currentLyrics = [];
let currentLyricIndex = -1;
let lyricsAutoScroll = true;
let isLyricsPanelOpen = false;

// Función para actualizar las letras según el tiempo actual
function updateLyrics(currentTime) {
    if (!currentLyrics || !currentLyrics.length) return;

    // Reverse scan: find the last line whose timestamp <= currentTime
    let newIndex = -1;
    for (let i = currentLyrics.length - 1; i >= 0; i--) {
        if (currentTime >= currentLyrics[i].time) {
            newIndex = i;
            break;
        }
    }

    if (newIndex === currentLyricIndex) return;  // no change
    currentLyricIndex = newIndex;

    if (!isLyricsPanelOpen) return;  // track index even when closed, skip DOM

    highlightCurrentLyric(newIndex);
    if (lyricsAutoScroll) scrollToLyric(newIndex);
}

// Función para resaltar la línea actual con efecto de contexto (prev/next)
function highlightCurrentLyric(index) {
    const lines = document.querySelectorAll('#lyricsText .lyrics-line');
    lines.forEach((line, i) => {
        line.classList.remove('active', 'lyr-prev1', 'lyr-prev2', 'lyr-next1', 'lyr-next2');
        if (index < 0) return;
        const diff = i - index;
        if      (diff ===  0) line.classList.add('active');
        else if (diff === -1) line.classList.add('lyr-prev1');
        else if (diff === -2) line.classList.add('lyr-prev2');
        else if (diff ===  1) line.classList.add('lyr-next1');
        else if (diff ===  2) line.classList.add('lyr-next2');
    });
}

// Función para hacer scroll a la línea actual
function scrollToLyric(index) {
    // Delegate to the right-panel scroll function if available
    if (typeof window._rpScrollToLyric === 'function') {
        window._rpScrollToLyric(index);
        return;
    }
    const currentLine = document.querySelector(`#lyricsText [data-index="${index}"]`);
    if (!currentLine || !lyricsAutoScroll) return;
    const container = document.querySelector('#rpLyricsPane .lyrics-content');
    if (!container) return;
    const targetScroll = currentLine.offsetTop - container.clientHeight * 0.38;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
}

// ─── Auto-fill related queue when playing from search ───────────────────────
async function autoFillRelatedQueue(song) {
    if (!song || !song.author) return;
    const requestId = ++_autoQueueRequestId;
    const author = song.author;
    const currentId = song.id;
    const currentTitleKey = normalizeSongTitle(song.title);

    // Detect genre keywords from the song title + author to build a genre query
    const _genreHints = ['reggaeton','pop','rock','trap','hip hop','r&b','latin','indie','electronic',
        'dance','house','soul','jazz','classical','folk','metal','punk','country','flamenco',
        'bachata','salsa','cumbia','urban','alternative','emo','drill'];
    const _titleLower = (song.title + ' ' + author).toLowerCase();
    let _detectedGenre = _genreHints.find(g => _titleLower.includes(g)) || '';

    // If no genre keyword found, infer from Spanish/Latin characters or known artists.
    // This catches artists like Quevedo, Bad Bunny, Bizarrap, etc.
    if (!_detectedGenre) {
        const _spanishChars = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(song.title + author);
        const _knownLatinArtists = /quevedo|bad bunny|bizarrap|feid|karol g|rauw|anuel|ozuna|maluma|j balvin|myke towers|jhay cortez|wisin|daddy yankee|nicki nicole|morad|c\.? ?tangana|pablo alboran|rosali|peso pluma|natanael cano|junior h|nodal|ivan cornejo/i.test(author);
        if (_spanishChars || _knownLatinArtists) {
            _detectedGenre = 'reggaeton latin urban';
        }
    }

    // Filter covers: title words not in artist name and not stopwords
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

    function _isCover(s) {
        if (_songKeys.length === 0) return false;
        const t = s.title.toLowerCase().replace(/[^\w\s]/g, ' ');
        const hits = _songKeys.filter(w => t.includes(w)).length;
        return hits >= Math.min(2, _songKeys.length);
    }

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

    // Build genre query; when still empty use a broad "similar" search seeded by the artist.
    const genreQuery = _detectedGenre
        ? `${_detectedGenre} hits`
        : `${author} similar artists mix`;

    let artistData = {}, genreData = {};
    const searches = [safeSearch(author)];
    if (genreQuery) searches.push(safeSearch(genreQuery));
    const settled = await Promise.allSettled(searches);
    if (requestId !== _autoQueueRequestId) return;
    if (settled[0] && settled[0].status === 'fulfilled') artistData = settled[0].value || {};
    if (settled[1] && settled[1].status === 'fulfilled') genreData = settled[1].value || {};

    const seen = new Set([currentId]);
    const seenTitles = new Set(currentTitleKey ? [currentTitleKey] : []);
    // Seed with every song currently in the queue so we never re-add anything already there
    for (const s of playlist) {
        if (!s) continue;
        const k = normalizeSongTitle(s.title);
        if (k) seenTitles.add(k);
        if (s.id) seen.add(s.id);
    }

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
function initRightPanel() {
    const panel           = document.getElementById('rightPanel');
    const lyricsBtn       = document.getElementById('lyricsBtn');
    const queueBtn        = document.getElementById('queueBtn');
    const nowPlayingBtn   = document.getElementById('nowPlayingBtn');
    const rpClose         = document.getElementById('rpClose');
    const rpTabQueue      = document.getElementById('rpTabQueue');
    const rpTabLyrics     = document.getElementById('rpTabLyrics');
    const rpTabNowPlaying = document.getElementById('rpTabNowPlaying');
    const queuePane       = document.getElementById('rpQueuePane');
    const lyricsPane      = document.getElementById('rpLyricsPane');
    const nowPlayingPane  = document.getElementById('rpNowPlayingPane');
    const mainContent     = document.querySelector('.main-content');
    const playerEl        = document.querySelector('.player');
    if (!panel) return;

    let isOpen     = false;
    let activeTab  = 'queue'; // 'queue' | 'lyrics' | 'nowplaying'
    let lyricsLoaded = null;  // id of song whose lyrics are loaded

    // ── Open / close ───────────────────────────────────────────────────────
    function openPanel(tab) {
        isOpen = true;
        panel.classList.add('show');
        mainContent && mainContent.classList.add('rp-open');
        switchTab(tab);
    }

    function closePanel() {
        isOpen = false;
        panel.classList.remove('show');
        mainContent && mainContent.classList.remove('rp-open');
        lyricsBtn      && lyricsBtn.classList.remove('rp-active');
        queueBtn       && queueBtn.classList.remove('rp-active');
        nowPlayingBtn  && nowPlayingBtn.classList.remove('rp-active');
        currentLyrics = [];
        currentLyricIndex = -1;
        isLyricsPanelOpen = false;
        lyricsLoaded = null;
    }

    // ── Tab switching ───────────────────────────────────────────────────────
    function switchTab(tab) {
        activeTab = tab;
        const isQueue      = tab === 'queue';
        const isLyrics     = tab === 'lyrics';
        const isNowPlaying = tab === 'nowplaying';

        rpTabQueue      && rpTabQueue.classList.toggle('rp-tab--active', isQueue);
        rpTabLyrics     && rpTabLyrics.classList.toggle('rp-tab--active', isLyrics);
        rpTabNowPlaying && rpTabNowPlaying.classList.toggle('rp-tab--active', isNowPlaying);

        queuePane      && queuePane.classList.toggle('rp-pane--hidden', !isQueue);
        lyricsPane     && lyricsPane.classList.toggle('rp-pane--hidden', !isLyrics);
        nowPlayingPane && nowPlayingPane.classList.toggle('rp-pane--hidden', !isNowPlaying);

        queueBtn      && queueBtn.classList.toggle('rp-active', isQueue);
        lyricsBtn     && lyricsBtn.classList.toggle('rp-active', isLyrics);
        nowPlayingBtn && nowPlayingBtn.classList.toggle('rp-active', isNowPlaying);
        isLyricsPanelOpen = isLyrics;

        if (isQueue) {
            renderQueue();
        } else if (isLyrics && currentSong && lyricsLoaded !== currentSong.id) {
            loadAndDisplayLyrics(currentSong.id, currentSong.title, currentSong.author);
        } else if (isNowPlaying) {
            renderNowPlaying();
        }
    }

    // ── Now Playing rendering ────────────────────────────────────────────────
    function extractDominantColor(imgEl, callback) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 8; canvas.height = 8;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, 8, 8);
            const d = ctx.getImageData(0, 0, 8, 8).data;
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < d.length; i += 4) {
                // Skip very dark or very bright pixels for better color
                const brightness = (d[i] + d[i+1] + d[i+2]) / 3;
                if (brightness < 20 || brightness > 230) continue;
                r += d[i]; g += d[i+1]; b += d[i+2]; count++;
            }
            if (count === 0) { callback('#1a1a2e', '#2d2d6b'); return; }
            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);
            // Darken for background use
            const c1 = `rgb(${Math.round(r*0.35)},${Math.round(g*0.35)},${Math.round(b*0.35)})`;
            const c2 = `rgb(${Math.round(r*0.55)},${Math.round(g*0.55)},${Math.round(b*0.55)})`;
            callback(c1, c2);
        } catch(e) { callback('#1a1a2e', '#2d2d6b'); }
    }

    const _songInsightsCache = new Map();
    let _insightsRequestId = 0;

    function formatCompactNumber(value) {
        const n = Number(value) || 0;
        if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
        return String(n);
    }

    function setInsightsLoadingState(text = 'Cargando') {
        const stateEl = document.getElementById('npvInsightsState');
        const playlistsEl = document.getElementById('npvInPlaylists');
        const featuringEl = document.getElementById('npvCreditFeaturing');
        const yearEl = document.getElementById('npvCreditYear');
        const viewsEl = document.getElementById('npvSongViews');

        if (stateEl) stateEl.textContent = text;
        if (playlistsEl) playlistsEl.textContent = 'Cargando...';
        if (featuringEl) featuringEl.textContent = '-';
        if (yearEl) yearEl.textContent = '-';
        if (viewsEl) viewsEl.textContent = '-';
    }

    function applySongInsights(insights) {
        const stateEl = document.getElementById('npvInsightsState');
        const playlistsEl = document.getElementById('npvInPlaylists');
        const featuringEl = document.getElementById('npvCreditFeaturing');
        const yearEl = document.getElementById('npvCreditYear');
        const viewsEl = document.getElementById('npvSongViews');

        if (stateEl) stateEl.textContent = 'Actualizado';

        const playlistNames = (insights.playlists && insights.playlists.names) || [];
        if (playlistsEl) {
            if (!playlistNames.length) {
                playlistsEl.textContent = 'No está en ninguna de tus playlists';
            } else {
                playlistsEl.innerHTML = playlistNames
                    .slice(0, 8)
                    .map(name => `<span class="npv-playlist-pill">${String(name).replace(/</g, '&lt;')}</span>`)
                    .join('');
            }
        }

        const credits = insights.credits || {};
        const song = insights.song || {};

        if (featuringEl) {
            const featuring = Array.isArray(credits.featuring) ? credits.featuring : [];
            featuringEl.textContent = featuring.length ? featuring.join(', ') : 'Sin colaboración';
        }
        if (yearEl) yearEl.textContent = (credits.release_year || song.year) ? String(credits.release_year || song.year) : '-';
        if (viewsEl) viewsEl.textContent = song.views ? formatCompactNumber(song.views) : '-';
    }

    async function loadSongInsights(song) {
        if (!song || !song.id) return;
        const cacheKey = `${song.id}::${song.author || ''}`;
        if (_songInsightsCache.has(cacheKey)) {
            applySongInsights(_songInsightsCache.get(cacheKey));
            return;
        }

        setInsightsLoadingState('Cargando');
        _insightsRequestId += 1;
        const reqId = _insightsRequestId;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(
                `/song-insights?id=${encodeURIComponent(song.id)}&artist=${encodeURIComponent(song.author || '')}&title=${encodeURIComponent(song.title || '')}`,
                {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                }
            );

            if (!response.ok) throw new Error('No se pudo cargar song-insights');
            const data = await response.json();
            if (reqId !== _insightsRequestId) return;

            _songInsightsCache.set(cacheKey, data);
            applySongInsights(data);
        } catch (e) {
            if (reqId !== _insightsRequestId) return;
            setInsightsLoadingState('No disponible');
            const playlistsEl = document.getElementById('npvInPlaylists');
            if (playlistsEl) playlistsEl.textContent = 'No se pudieron cargar los detalles';
        }
    }

    function renderNowPlaying() {
        if (!nowPlayingPane) return;
        const npvBg            = document.getElementById('npvBg');
        const npvArt           = document.getElementById('npvArt');
        const npvArtWrap       = document.getElementById('npvArtWrap');
        const npvArtPlaceholder= document.getElementById('npvArtPlaceholder');
        const npvTitle         = document.getElementById('npvTitle');
        const npvArtistEl      = document.getElementById('npvArtist');
        const npvMetaDuration  = document.getElementById('npvMetaDuration');
        const npvMetaStatus    = document.getElementById('npvMetaStatus');
        const npvMetaQueue     = document.getElementById('npvMetaQueue');
        const npvLikeBtn       = document.getElementById('npvLikeBtn');
        const npvAddBtn        = document.getElementById('npvAddBtn');
        const npvMoreBtn       = document.getElementById('npvMoreBtn');
        const npvNextRow       = document.getElementById('npvNextRow');
        const npvNextSection   = document.getElementById('npvNextSection');

        function refreshNowPlayingStats() {
            const songDuration = Number(currentSong && currentSong.duration) || 0;
            const audioDuration = (currentAudio && Number.isFinite(currentAudio.duration))
                ? Math.floor(currentAudio.duration)
                : 0;
            const totalDuration = songDuration || audioDuration;
            const queuePos = currentIndex >= 0 ? `${currentIndex + 1} de ${playlist.length || 1}` : '-';
            const status = isLoading
                ? 'Cargando'
                : ((currentAudio && !currentAudio.paused) ? 'Reproduciendo' : 'Pausada');

            if (npvMetaDuration) npvMetaDuration.textContent = totalDuration > 0 ? formatDuration(totalDuration) : '--:--';
            if (npvMetaQueue) npvMetaQueue.textContent = queuePos;
            if (npvMetaStatus) npvMetaStatus.textContent = currentSong ? status : 'Sin reproducir';
        }

        window._rpRefreshNowPlayingStats = refreshNowPlayingStats;

        if (!currentSong) {
            if (npvTitle) npvTitle.textContent = 'Sin canción';
            if (npvArtistEl) npvArtistEl.textContent = '';
            if (npvArt) { npvArt.src = ''; npvArtWrap && npvArtWrap.classList.remove('has-img'); }
            setInsightsLoadingState('Sin canción');
            refreshNowPlayingStats();
            return;
        }

        // Title + artist
        if (npvTitle) npvTitle.textContent = currentSong.title || 'Sin título';
        if (npvArtistEl) npvArtistEl.textContent = currentSong.author || '';
        loadSongInsights(currentSong);

        // Album art
        if (npvArt && currentSong.thumbnail) {
            npvArt.crossOrigin = 'anonymous';
            npvArt.src = currentSong.thumbnail;
            npvArtWrap && npvArtWrap.classList.add('has-img');
            npvArt.onload = () => {
                extractDominantColor(npvArt, (c1, c2) => {
                    if (npvBg) {
                        npvBg.style.setProperty('--npv-color1', c1);
                        npvBg.style.setProperty('--npv-color2', c2);
                        npvBg.style.background = `${c1}`;
                        npvBg.style.backgroundImage = `radial-gradient(ellipse at 50% 0%, ${c2} 0%, transparent 70%)`;
                    }
                });
            };
            npvArt.onerror = () => { npvArtWrap && npvArtWrap.classList.remove('has-img'); };
        } else if (npvArtWrap) {
            npvArtWrap.classList.remove('has-img');
        }

        // Like button state
        if (npvLikeBtn) {
            const isLiked = likedSongs && likedSongs.includes(currentSong.id);
            npvLikeBtn.classList.toggle('liked', !!isLiked);
            npvLikeBtn.querySelector('.npv-like-empty').style.display = isLiked ? 'none' : '';
            npvLikeBtn.querySelector('.npv-like-filled').style.display = isLiked ? '' : 'none';
            npvLikeBtn.onclick = () => {
                const playerLikeBtn = document.getElementById('playerLikeBtn');
                if (playerLikeBtn) playerLikeBtn.click();
                setTimeout(renderNowPlaying, 300);
            };
        }

        // Add to playlist
        if (npvAddBtn) {
            npvAddBtn.onclick = () => {
                const addBtn = document.getElementById('addToPlaylistBtn');
                if (addBtn) addBtn.click();
            };
        }

        // More options (trigger context menu)
        if (npvMoreBtn && currentSong) {
            npvMoreBtn.onclick = () => {
                openSongContextMenu(currentSong, npvMoreBtn);
            };
        }

        // Next up
        if (npvNextRow && npvNextSection) {
            const nextSong = playlist[currentIndex + 1];
            if (nextSong) {
                npvNextSection.style.display = '';
                npvNextRow.innerHTML = `
                    <img class="npv-next-thumb" src="${nextSong.thumbnail || ''}" alt="" onerror="this.style.display='none'">
                    <div class="npv-next-info">
                        <div class="npv-next-title">${(nextSong.title || 'Sin título').replace(/</g,'&lt;')}</div>
                        <div class="npv-next-artist">${(nextSong.author || '').replace(/</g,'&lt;')}</div>
                    </div>
                `;
                npvNextRow.onclick = () => playSongAtIndex(currentIndex + 1);
            } else {
                npvNextSection.style.display = 'none';
                npvNextRow.innerHTML = '';
            }
        }

        refreshNowPlayingStats();
    }

    // ── Queue rendering ─────────────────────────────────────────────────────
    function renderQueue() {
        const nowRow    = document.getElementById('rpNowRow');
        const queueList = document.getElementById('rpQueueList');
        const nextSec   = document.getElementById('rpNextSection');
        if (!nowRow || !queueList) return;

        // Now playing row
        if (currentSong) {
            nowRow.innerHTML = buildQueueRowHTML(currentSong, true);
        } else {
            nowRow.innerHTML = '<p class="rp-empty">Ninguna canción reproduciéndose</p>';
        }

        // Upcoming
        const upcoming = playlist.slice(currentIndex + 1);
        if (upcoming.length === 0) {
            queueList.innerHTML = '<p class="rp-empty">No hay más canciones en la cola</p>';
            if (nextSec) nextSec.style.display = 'block';
            return;
        }

        if (nextSec) nextSec.style.display = 'block';
        queueList.innerHTML = '';
        let dragSrcIdx = null;

        upcoming.forEach((song, i) => {
            const div = document.createElement('div');
            div.innerHTML = buildQueueRowHTML(song, false);
            const row = div.firstElementChild;
            row.dataset.queueIdx = i;
            // Draggable on the whole row
            row.setAttribute('draggable', 'true');

            row.addEventListener('click', () => {
                if (!row.dragging) playSongAtIndex(currentIndex + 1 + i);
            });

            row.addEventListener('dragstart', (e) => {
                dragSrcIdx = i;
                row.dragging = true;
                e.dataTransfer.effectAllowed = 'move';
                requestAnimationFrame(() => row.classList.add('rp-queue-row--dragging'));
            });

            row.addEventListener('dragend', () => {
                dragSrcIdx = null;
                row.dragging = false;
                queueList.querySelectorAll('.rp-queue-row--dragging, .rp-queue-row--drag-over')
                    .forEach(el => el.classList.remove('rp-queue-row--dragging', 'rp-queue-row--drag-over'));
            });

            row.addEventListener('dragover', (e) => {
                if (dragSrcIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragSrcIdx !== i) row.classList.add('rp-queue-row--drag-over');
            });

            row.addEventListener('dragleave', (e) => {
                if (!row.contains(e.relatedTarget)) {
                    row.classList.remove('rp-queue-row--drag-over');
                }
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('rp-queue-row--drag-over');
                const destIdx = parseInt(row.dataset.queueIdx);
                if (dragSrcIdx === null || dragSrcIdx === destIdx) return;
                const offset = currentIndex + 1;
                const [moved] = playlist.splice(offset + dragSrcIdx, 1);
                playlist.splice(offset + destIdx, 0, moved);
                renderQueue();
            });

            queueList.appendChild(row);
        });
    }

    function buildQueueRowHTML(song, isCurrent) {
        const thumb  = song.thumbnail || '';
        const title  = (song.title || 'Sin título').replace(/</g, '&lt;');
        const artist = (song.author || 'Desconocido').replace(/</g, '&lt;');
        const dur    = song.duration ? formatDuration(song.duration) : '';
        const letter = title.charAt(0).toUpperCase();
        const thumbEl = thumb
            ? `<img src="${thumb}" alt="${title}" class="rp-queue-thumb">`
            : `<div class="rp-queue-thumb rp-queue-thumb--ph">${letter}</div>`;
        const currentClass = isCurrent ? ' rp-queue-row--current' : '';
        const handle = isCurrent ? '' : `<span class="rp-drag-handle" aria-hidden="true">⠿</span>`;
        return `
            <div class="rp-queue-row${currentClass}">
                ${handle}
                ${thumbEl}
                <div class="rp-queue-meta">
                    <span class="rp-queue-title">${title}</span>
                    <span class="rp-queue-artist">${artist}</span>
                </div>
                ${dur ? `<span class="rp-queue-dur">${dur}</span>` : ''}
            </div>`;
    }

    // ── Lyrics loading (migrado desde initLyricsPanel) ──────────────────────
    async function loadAndDisplayLyrics(songId, songTitle, artist) {
        const lyricsText = document.getElementById('lyricsText');
        if (!lyricsText) return;
        lyricsText.innerHTML = '<div class="lyrics-line" style="opacity:0.5;font-size:18px;">Cargando letra…</div>';
        try {
            const params = new URLSearchParams({ id: songId });
            if (artist)    params.set('artist', artist);
            if (songTitle) params.set('title', songTitle);
            const response = await fetch(`/lyrics?${params.toString()}`);
            if (!response.ok) throw new Error(`${response.status}`);
            const data = await response.json();

            if (!data.lyrics) {
                lyricsText.innerHTML = `
                    <div class="lyrics-line" style="opacity:0.5;font-size:18px;">No se encontraron letras</div>
                    <div class="lyrics-line" style="opacity:0.35;font-size:14px;">${songTitle} · ${artist}</div>`;
                lyricsLoaded = songId;
                return;
            }

            try {
                let parsedLines = JSON.parse(data.lyrics);

                // ── Plain lyrics: distribute timestamps based on song duration ──
                if (data.plainText) {
                    // Estimate song duration; fall back to 210s (3:30)
                    const dur = (currentSong && currentSong.duration) ? currentSong.duration : 210;
                    // Start at ~8% (after typical intro), end at ~94%
                    const startT = Math.round(dur * 0.08);
                    const endT   = Math.round(dur * 0.94);
                    const n      = parsedLines.length;
                    const step   = n > 1 ? (endT - startT) / (n - 1) : 0;
                    parsedLines = parsedLines.map((l, i) => ({
                        time: Math.round(startT + i * step),
                        text: l.text
                    }));
                }

                currentLyrics = parsedLines;
                currentLyricIndex = -1;
                currentLyrics.sort((a, b) => a.time - b.time);
                const html = currentLyrics.map((line, i) => {
                    const t = line.text ? line.text.trim() : '';
                    if (!t) return '';
                    return `<div class="lyrics-line" data-time="${line.time || 0}" data-index="${i}">${t}</div>`;
                }).filter(Boolean).join('');
                lyricsText.innerHTML = html;
                Array.from(lyricsText.getElementsByClassName('lyrics-line')).forEach(el => {
                    el.addEventListener('click', () => {
                        if (currentAudio && el.dataset.time) {
                            currentAudio.currentTime = parseInt(el.dataset.time);
                            highlightCurrentLyric(parseInt(el.dataset.index));
                            scrollToLyricInPanel(parseInt(el.dataset.index));
                        }
                    });
                });
                // Jump to current playback position immediately (no animation on initial load)
                const nowTime = currentAudio ? currentAudio.currentTime : 0;
                currentLyricIndex = -1;  // force re-detect
                updateLyrics(nowTime);
                // Instant scroll on open (override smooth)
                if (currentLyricIndex >= 0) {
                    const el = lyricsText.querySelector(`[data-index="${currentLyricIndex}"]`);
                    const container = document.querySelector('#rpLyricsPane .lyrics-content');
                    if (el && container) {
                        container.scrollTop = Math.max(0, el.offsetTop - container.clientHeight * 0.38);
                    }
                }
            } catch {
                const lines = data.lyrics.split('\n').filter(l => l.trim());
                lyricsText.innerHTML = lines.map(l => `<div class="lyrics-line">${l}</div>`).join('');
            }
            lyricsLoaded = songId;
        } catch (err) {
            lyricsText.innerHTML = `<div class="lyrics-line" style="opacity:0.5;font-size:18px;">Error cargando la letra</div>`;
        }
    }

    function scrollToLyricInPanel(index) {
        const el = document.querySelector(`#rpLyricsPane [data-index="${index}"]`);
        if (!el || !lyricsAutoScroll) return;
        const container = document.querySelector('#rpLyricsPane .lyrics-content');
        if (!container) return;
        // Position active line ~40% from top so upcoming lines are visible below
        const targetScroll = el.offsetTop - container.clientHeight * 0.38;
        container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }

    // ── Button wiring ───────────────────────────────────────────────────────
    queueBtn && queueBtn.addEventListener('click', () => {
        if (isOpen && activeTab === 'queue') closePanel();
        else openPanel('queue');
    });

    lyricsBtn && lyricsBtn.addEventListener('click', () => {
        if (isOpen && activeTab === 'lyrics') closePanel();
        else openPanel('lyrics');
    });

    nowPlayingBtn && nowPlayingBtn.addEventListener('click', () => {
        if (isOpen && activeTab === 'nowplaying') closePanel();
        else openPanel('nowplaying');
    });

    // Clicking the player thumbnail also opens Now Playing
    const playerThumb = document.getElementById('playerThumbnail');
    playerThumb && playerThumb.addEventListener('click', () => {
        if (isOpen && activeTab === 'nowplaying') closePanel();
        else openPanel('nowplaying');
    });

    rpTabQueue      && rpTabQueue.addEventListener('click', () => switchTab('queue'));
    rpTabLyrics     && rpTabLyrics.addEventListener('click', () => switchTab('lyrics'));
    rpTabNowPlaying && rpTabNowPlaying.addEventListener('click', () => switchTab('nowplaying'));
    rpClose && rpClose.addEventListener('click', closePanel);

    // ── Refresh on song change ──────────────────────────────────────────────
    const _origPlay = window.playSongAtIndex;
    window.playSongAtIndex = async function(index) {
        await _origPlay(index);
        lyricsLoaded = null;
        // Auto-fill queue with related songs whenever only 1 song is queued
        // (single song from home tiles, search results, recently played, etc.)
        const seedSong = playlist[currentIndex];
        const shouldAutoFill = !!seedSong && (playlist.length <= 1 || window._isSearchPlaylist);
        if (shouldAutoFill) {
            const seedKey = `${seedSong.id || ''}::${normalizeSongTitle(seedSong.title)}`;
            if (_autoQueueInFlightSeed !== seedKey) {
                _autoQueueInFlightSeed = seedKey;
                // Search context should trigger auto-fill once, not on every next song.
                window._isSearchPlaylist = false;
                autoFillRelatedQueue(seedSong).finally(() => {
                    if (_autoQueueInFlightSeed === seedKey) _autoQueueInFlightSeed = null;
                });
            }
        }
        if (!isOpen) {
            // Auto-open Now Playing panel when a song starts
            openPanel('nowplaying');
            return;
        }
        if (activeTab === 'queue') renderQueue();
        else if (activeTab === 'lyrics' && currentSong) {
            loadAndDisplayLyrics(currentSong.id, currentSong.title, currentSong.author);
        } else if (activeTab === 'nowplaying') {
            renderNowPlaying();
        }
    };

    // Expose so updateLyrics (global) can call scroll
    window._rpScrollToLyric = scrollToLyricInPanel;
    // Expose renderNowPlaying so like-button updates can refresh it
    window._rpRenderNowPlaying = renderNowPlaying;
    // Expose renderQueue for auto-fill refresh
    window._rpRenderQueue = renderQueue;
    // Expose openPanel for external callers
    window._rpOpenPanel = openPanel;
}

// Authentication functionality
const profileBtn = document.getElementById('profileBtn');

function isLoggedIn() {
    return !!localStorage.getItem('token');
}

function checkAuthStatus() {
    const displayEl = document.getElementById('profileTooltip');
    const nameDisplayEl = document.getElementById('userInitial');
    if (!displayEl) return;
    const token = localStorage.getItem('token');
    let user = null;
    try {
        user = JSON.parse(localStorage.getItem('user') || 'null');
    } catch (e) {
        localStorage.removeItem('user');
        user = null;
    }
    if (token && user && user.username) {
        displayEl.textContent = user.username;
        if (nameDisplayEl) {
            nameDisplayEl.textContent = user.username.charAt(0).toUpperCase();
        }
    } else {
        displayEl.textContent = 'Iniciar Sesión';
        if (nameDisplayEl) {
            nameDisplayEl.textContent = 'I';
        }
    }
}

function initAuthUI() {
    const token = localStorage.getItem('token');
    let user = null;
    try {
        user = JSON.parse(localStorage.getItem('user') || 'null');
    } catch (e) {
        localStorage.removeItem('user');
        user = null;
    }
    if (!token || !user || !user.username) {
        window.location.href = 'login.html';
        return;
    }
    // Detectar cambio de usuario: si el ID almacenado no coincide, limpiar caché
    const lastUserId = localStorage.getItem('lastUserId');
    const currentUserId = String(user.id ?? user.username);
    if (lastUserId && lastUserId !== currentUserId) {
        localStorage.removeItem(MADE_FOR_YOU_KEY);
        localStorage.removeItem('likedSongs');
        localStorage.removeItem('recentlyPlayed');
        localStorage.removeItem('recientesPlaylistId');
    }
    localStorage.setItem('lastUserId', currentUserId);
    checkAuthStatus();
    window.addEventListener('storage', (e) => {
        if (e.key === 'token' || e.key === 'user') checkAuthStatus();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initAuthUI();
        initRightPanel();
    });
} else {
    initAuthUI();
    initRightPanel();
}

function handleProfileClick() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const profileMenu = document.getElementById('profileMenu');
    const profileTooltip = document.getElementById('profileTooltip');
    if (profileMenu.classList.contains('show')) {
        profileMenu.classList.remove('show');
        profileTooltip.classList.remove('show');
    } else {
        profileMenu.classList.add('show');
        profileTooltip.classList.add('show');
    }
}

if (profileBtn) {
    profileBtn.addEventListener('click', handleProfileClick);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        const pb = document.getElementById('profileBtn');
        if (pb) pb.addEventListener('click', handleProfileClick);
    });
}

function clearUserLocalStorage() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(MADE_FOR_YOU_KEY); // playlists autogeneradas
    localStorage.removeItem('likedSongs');
    localStorage.removeItem('recentlyPlayed');
    localStorage.removeItem('recientesPlaylistId');
    localStorage.removeItem('lastUserId');
}

function logout() {
    clearUserLocalStorage();
    window.location.href = 'login.html';
}

document.addEventListener('click', (e) => {
    const profileMenu = document.getElementById('profileMenu');
    const profileTooltip = document.getElementById('profileTooltip');
    const profileBtn = document.getElementById('profileBtn');
    if (!profileBtn.contains(e.target) && !profileMenu.contains(e.target)) {
        profileMenu.classList.remove('show');
        profileTooltip.classList.remove('show');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const accountItem = document.querySelector('.profile-menu-item:nth-child(1)');
    if (accountItem) accountItem.addEventListener('click', () => { alert('Funcionalidad de Cuenta próximamente disponible'); closeProfileMenu(); });
    const profileItem = document.querySelector('.profile-menu-item:nth-child(2)');
    if (profileItem) profileItem.addEventListener('click', () => { alert('Funcionalidad de Perfil próximamente disponible'); closeProfileMenu(); });
    const supportItem = document.querySelector('.profile-menu-item:nth-child(3)');
    if (supportItem) supportItem.addEventListener('click', () => { alert('Funcionalidad de Soporte próximamente disponible'); closeProfileMenu(); });
    const privateSessionItem = document.querySelector('.profile-menu-item:nth-child(4)');
    if (privateSessionItem) privateSessionItem.addEventListener('click', () => { alert('Sesión privada activada'); closeProfileMenu(); });
    const settingsItem = document.querySelector('.profile-menu-item:nth-child(5)');
    if (settingsItem) settingsItem.addEventListener('click', () => { alert('Funcionalidad de Configuración próximamente disponible'); closeProfileMenu(); });
    const logoutItem = document.querySelector('.profile-menu-item[data-action="logout"]');
    if (logoutItem) logoutItem.addEventListener('click', () => { logout(); closeProfileMenu(); });
});

function closeProfileMenu() {
    const profileMenu = document.getElementById('profileMenu');
    const profileTooltip = document.getElementById('profileTooltip');
    profileMenu.classList.remove('show');
    profileTooltip.classList.remove('show');
}


// Create Playlist Modal Functions
function openCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModal');
    const input = document.getElementById('playlistNameInput');
    const msg   = document.getElementById('createPlaylistMessage');

    if (input) input.value = '';
    const descEl = document.getElementById('playlistDescInput');
    if (descEl) descEl.value = '';
    if (msg)   msg.textContent = '';

    modal.style.display = 'flex';
    requestAnimationFrame(() => input?.focus());

    function onKeydown(e) {
        if (e.key === 'Enter')  { e.preventDefault(); createPlaylist(); }
        if (e.key === 'Escape') { e.preventDefault(); closeCreatePlaylistModal(); }
    }
    input?.addEventListener('keydown', onKeydown);
    modal._cleanupKeydown = () => input?.removeEventListener('keydown', onKeydown);
}

function closeCreatePlaylistModal() {
    const modal = document.getElementById('createPlaylistModal');
    modal.style.display = 'none';
    document.getElementById('playlistNameInput').value = '';
    document.getElementById('createPlaylistMessage').textContent = '';
    if (modal._cleanupKeydown) { modal._cleanupKeydown(); delete modal._cleanupKeydown; }
}

async function createPlaylist() {
    const name = document.getElementById('playlistNameInput').value.trim();
    if (!name) {
        document.getElementById('createPlaylistMessage').textContent = 'Por favor, ingresa un nombre para la playlist.';
        return;
    }
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Debes iniciar sesión para crear playlists.');
            window.location.href = 'login.html';
            return;
        }
        const response = await fetch('/create-playlist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name })
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

async function loadAndDisplayPlaylist(playlistId, playlistNameFallback) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Debes iniciar sesión para ver playlists.');
            window.location.href = 'login.html';
            return;
        }

        const response = await fetch(`/playlist-songs?playlist_id=${playlistId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();

        if (result.error) {
            alert('Error: ' + result.error);
            return;
        }

        if (!result.playlist || !Array.isArray(result.songs)) {
            alert('Formato de playlist inválido.');
            return;
        }

        const playlistData = {
            playlistName: result.playlist.name || playlistNameFallback || 'Sin nombre',
            songs: result.songs,
            owner: 'Tú'
        };

        // Prefetch las primeras canciones para reducir latencia al reproducir
        prefetchSongs(result.songs);

        // âœ… Solo llama a displayPlaylistView, sin tocar resultsDiv
        displayPlaylistView(playlistData);

    } catch (error) {
        console.error('Error al cargar playlist:', error);
        alert('No se pudo cargar la playlist.');
    }
}

function displayPlaylists(playlists) {
    const playlistsList = document.getElementById('playlistsList');
    if (!playlistsList) return;
    playlistsList.innerHTML = '';

    // Liked songs fixed item
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
            <div class="sidebar-pl-meta">Lista de reproducción</div>
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
        playlistItem.innerHTML = `
            <img src="${getPlaylistCover(playlist)}" alt="${playlist.name}" class="sidebar-pl-cover">
            <div class="sidebar-pl-info">
                <div class="sidebar-pl-name">${playlist.name}</div>
                <div class="sidebar-pl-meta">Lista de reproducción</div>
            </div>
            <div class="sidebar-pl-now-playing">
                <div class="sidebar-pl-bar"></div>
                <div class="sidebar-pl-bar"></div>
                <div class="sidebar-pl-bar"></div>
            </div>
        `;
        playlistItem.addEventListener('click', () => loadAndDisplayPlaylist(playlist.id, playlist.name));
        playlistsList.appendChild(playlistItem);
    });

    // â”€â”€ Empty state when user has no playlists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (playlists.length === 0) {
        const emptyCards = document.createElement('div');
        emptyCards.className = 'sidebar-lib-empty-cards';
        emptyCards.innerHTML = `
            <div class="sidebar-lib-empty-card">
                <h4>Crea tu primera lista</h4>
                <p>Es muy fácil, te lo prometemos.</p>
                <button class="sidebar-lib-empty-btn" id="libEmptyCreateBtn">Crear lista</button>
            </div>
            <div class="sidebar-lib-empty-card">
                <h4>Descubre nueva música</h4>
                <p>Busca artistas, géneros y canciones que te gusten.</p>
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

// Filter sidebar playlists by name
function filterSidebarPlaylists(query) {
    const items = document.querySelectorAll('#playlistsList .playlist-item');
    const q = query.trim().toLowerCase();
    items.forEach(item => {
        const name = (item.dataset.name || '').toLowerCase();
        item.classList.toggle('hidden', q.length > 0 && !name.includes(q));
    });
}

// Display playlists in library grid (portrait cards)
function displayLibrary(playlists) {
    const libraryGrid = document.getElementById('libraryGrid');
    libraryGrid.innerHTML = '';

    // â”€â”€ Tarjeta fija: Canciones que te gustan â”€â”€
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
            <div class="pl-card-meta">Lista de reproducción "¢ ${likedList.length} canciones</div>
        </div>
    `;
    likedCard.addEventListener('click', (e) => {
        if (!e.target.closest('.pl-card-play')) openLikedSongsView();
    });
    likedCard.querySelector('.pl-card-play').addEventListener('click', (e) => {
        e.stopPropagation();
        const songs = getLikedSongsPlaylist();
        const queueSongs = dedupeSongsByTitle(songs);
        if (queueSongs.length) { playlist = queueSongs; playSongAtIndex(0); }
    });
    libraryGrid.appendChild(likedCard);

    // â”€â”€ Playlists del usuario â”€â”€
    playlists.forEach(playlist_ => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        const coverSrc = getPlaylistCover(playlist_);
        card.innerHTML = `
            <div class="pl-card-cover">
                <img src="${coverSrc}" alt="${playlist_.name}" style="width:100%;height:100%;object-fit:cover;display:block;">
                <button class="pl-card-play" title="Reproducir">
                    <svg viewBox="0 0 24 24" width="24" height="24"><path fill="#000" d="M8 5v14l11-7z"/></svg>
                </button>
            </div>
            <div class="pl-card-info">
                <div class="pl-card-name">${playlist_.name}</div>
                <div class="pl-card-meta">Lista de reproducción</div>
            </div>
            <button class="delete-playlist-btn" title="Eliminar playlist">
                <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
        `;
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-playlist-btn') && !e.target.closest('.pl-card-play')) {
                loadAndDisplayPlaylist(playlist_.id, playlist_.name);
            }
        });
        card.querySelector('.pl-card-play').addEventListener('click', (e) => {
            e.stopPropagation();
            loadAndDisplayPlaylist(playlist_.id, playlist_.name);
        });
        card.querySelector('.delete-playlist-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deletePlaylist(playlist_.id);
        });
        libraryGrid.appendChild(card);
    });
}

// Load library function to fetch and display playlists in grid
async function loadLibrary() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Debes iniciar sesión para ver tu biblioteca.');
            window.location.href = 'login.html';
            return;
        }
        const response = await fetch('/user-playlists', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const { data: result, raw } = await readJsonResponse(response);
        if (!response.ok) {
            throw new Error((result && (result.error || result.message)) || raw || `HTTP ${response.status}`);
        }
        if (!result) {
            throw new Error('Respuesta inválida del servidor');
        }
        if (result.playlists) {
            displayLibrary(result.playlists);
            displayPlaylists(result.playlists);
        } else {
            document.getElementById('libraryGrid').innerHTML = '<p>No tienes playlists aún. Crea una nueva para empezar.</p>';
        }
    } catch (error) {
        console.error('Error loading library:', error);
        document.getElementById('libraryGrid').innerHTML = '<p>Error al cargar la biblioteca.</p>';
    }
}

// Delete playlist function
window.deletePlaylist = async function deletePlaylist(playlistId) {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Debes iniciar sesión para eliminar playlists.');
            window.location.href = 'login.html';
            return;
        }
        const response = await fetch('/delete-playlist', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ playlist_id: playlistId })
        });
        let result;
        if (response.ok) {
            result = await response.json();
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
};

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
// Reproducir canción por índice en playlist con streaming en línea
window.playSongAtIndex = async function playSongAtIndex(index) {
    if (index < 0 || index >= playlist.length || isLoading) return;
    currentIndex = index;
    updatePlayingRow();
    const song = playlist[index];
    isLoading = true;
    try {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        playerThumbnail.src = song.thumbnail;
        playerTitle.textContent = truncateTitle(song.title);
        playerAuthor.textContent = song.author;
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
        player.classList.add('show');
        progressFill.style.width = '0%';
        currentTimeEl.textContent = '0:00';
        durationEl.textContent = '0:00';
        updatePlayPauseIcon(); // show pause icon while loading
        currentAudio = new Audio();
        currentAudio.preload = 'auto';
        currentAudio.volume = currentVolume; // set volume before loading
        currentAudio.src = `/audio?id=${song.id}`;
        currentAudio.addEventListener('canplay', () => {
            if (!currentAudio.paused) return; // already playing
            currentAudio.play().catch((error) => {
                console.error('Error playing audio:', error);
                updatePlayPauseIcon();
            });
        }, { once: true });
        currentAudio.addEventListener('loadedmetadata', () => {
            durationEl.textContent = formatDuration(Math.floor(currentAudio.duration));
            if (typeof window._rpRefreshNowPlayingStats === 'function') {
                window._rpRefreshNowPlayingStats();
            }
        });
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
    const { playlistName, songs, owner } = playlistData;
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
        removeBtn.addEventListener('click', e => e.stopPropagation());
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
    clearTimeout(searchTimeout);

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

// Populate home view "” Spotify Desktop style
function populateHomeCards() {
    // â”€â”€ Greeting (time-based) + dynamic gradient â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const h = new Date().getHours();
    const greetingEl = document.getElementById('greetingText');
    if (greetingEl) {
        const greeting = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
        const userRaw = localStorage.getItem('user');
        let username = '';
        try { username = userRaw ? (JSON.parse(userRaw).username || '') : ''; } catch (_) {}
        greetingEl.textContent = username ? `${greeting}, ${username}` : greeting;
    }
    // Dynamic gradient color based on time
    const grad = document.getElementById('homeHeaderGradient');
    if (grad) {
        const color = h < 6 ? '#0d1b2a' : h < 12 ? '#1a3a5c' : h < 18 ? '#1e3264' : '#2d1b4e';
        grad.style.background = `linear-gradient(180deg, ${color} 0%, ${color}cc 30%, ${color}55 60%, transparent 100%)`;
    }

    // â”€â”€ Recently played "” compact 3À—2 tile grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const recentGrid = document.getElementById('recentGrid');
    if (recentGrid) {
        recentGrid.innerHTML = '';
        const items = recentlyPlayed.slice(0, 6);
        if (items.length > 0) {
            items.forEach((song, index) => {
                const tile = document.createElement('div');
                tile.className = 'recent-tile';
                if (song.thumbnail) {
                    tile.innerHTML = `<img src="${song.thumbnail}" alt="${song.title}" class="recent-tile-img">`;
                } else {
                    const letter = (song.title || '?').charAt(0).toUpperCase();
                    tile.innerHTML = `<div class="recent-tile-letter">${letter}</div>`;
                }
                const nameSpan = document.createElement('span');
                nameSpan.className = 'recent-tile-name';
                nameSpan.textContent = song.title || 'Sin título';
                tile.appendChild(nameSpan);
                const playBtn = document.createElement('button');
                playBtn.className = 'recent-tile-play';
                playBtn.setAttribute('aria-label', 'Reproducir');
                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
                tile.appendChild(playBtn);
                const play = (e) => {
                    e && e.stopPropagation();
                    playlist = [song];
                    playSongAtIndex(0);
                };
                playBtn.addEventListener('click', play);
                tile.addEventListener('click', play);
                recentGrid.appendChild(tile);
            });
        }
    }

    // â”€â”€ Jump back in "” last 6 distinct songs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const jumpBackSection = document.getElementById('jumpBackSection');
    const jumpBackSlider = document.getElementById('jumpBackSlider');
    if (jumpBackSlider && recentlyPlayed.length > 0) {
        jumpBackSlider.innerHTML = '';
        // deduplicate by id, take top 8
        const seen = new Set();
        const unique = [];
        for (const s of recentlyPlayed) {
            if (!seen.has(s.id)) { seen.add(s.id); unique.push(s); }
            if (unique.length >= 8) break;
        }
        unique.forEach((song, i) => {
            const fakePl = {
                id: 'jump-' + i, name: song.title,
                description: song.author, songs: [song], _isSong: true
            };
            const card = buildSpCard(fakePl, () => {
                 playlist = [song];
                 playSongAtIndex(0);
            });
            jumpBackSlider.appendChild(card);
        });
        if (jumpBackSection) jumpBackSection.style.display = 'block';
    } else if (jumpBackSection) {
        jumpBackSection.style.display = 'none';
    }

    // â”€â”€ Made For You slider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const madeForYouSlider = document.getElementById('madeForYouSlider');
    const madeForYouSection = document.getElementById('madeForYouSection');
    if (madeForYouSlider) {
        madeForYouSlider.innerHTML = '';
        let mfyPlaylists = loadMadeForYouPlaylists();
        if (!mfyPlaylists) {
            mfyPlaylists = recentlyPlayed.length > 0
                ? [{ id: 'recientes', name: 'Recientes', songs: recentlyPlayed.slice(), owner: 'Tú' },
                   ...generateRecommendations(recentlyPlayed)]
                : [];
            if (mfyPlaylists.length) {
                saveMadeForYouPlaylists(mfyPlaylists);
                syncAutoPlaylistToDB({ id: 'recientes', name: 'Recientes', songs: recentlyPlayed.slice(), owner: 'Tú', description: '' });
            }
        } else {
            if (recentlyPlayed.length > 0) {
                const rpIdx = mfyPlaylists.findIndex(p => p.id === 'recientes');
                if (rpIdx > -1) mfyPlaylists[rpIdx].songs = recentlyPlayed.slice();
                else mfyPlaylists.unshift({ id: 'recientes', name: 'Recientes', songs: recentlyPlayed.slice(), owner: 'Tú' });
            }
        }
        if (mfyPlaylists.length > 0) {
            if (madeForYouSection) madeForYouSection.style.display = 'block';
            mfyPlaylists.forEach(pl => {
                const card = buildSpCard(pl);
                if (pl.id === DISCOVERY_ID) {
                    card.classList.add('discovery-card');
                    const updateBtn = document.createElement('button');
                    updateBtn.className = 'update-discovery-btn';
                    updateBtn.textContent = 'Actualizar';
                    updateBtn.title = 'Regenerar Descubrimiento Semanal';
                    updateBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        updateBtn.disabled = true;
                        updateBtn.textContent = 'Actualizando"¦';
                        try {
                            await refreshDiscoveryNow();
                            const newPl = (loadMadeForYouPlaylists() || []).find(x => x.id === DISCOVERY_ID) || pl;
                            const sub = card.querySelector('.sp-card-sub');
                            if (sub) sub.textContent = `${(newPl.songs || []).length} canciones`;
                            const lastEl = card.querySelector('.discovery-updated');
                            if (lastEl) lastEl.textContent = `Actualizado: ${formatRelativeDate(newPl.lastUpdated)}`;
                        } catch (err) {
                            console.error('Error actualizando descubrimiento:', err);
                        } finally {
                            updateBtn.disabled = false;
                            updateBtn.textContent = 'Actualizar';
                        }
                    });
                    card.appendChild(updateBtn);
                    const lastTs = pl.lastUpdated;
                    const lastEl = document.createElement('p');
                    lastEl.className = 'discovery-updated';
                    lastEl.textContent = `Actualizado: ${formatRelativeDate(lastTs)}`;
                    card.appendChild(lastEl);
                }
                madeForYouSlider.appendChild(card);
            });
        } else {
            if (madeForYouSection) madeForYouSection.style.display = 'none';
        }
    }

    // â”€â”€ Top Artists slider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const topArtistsSection = document.getElementById('topArtistsSection');
    const topArtistsSlider = document.getElementById('topArtistsSlider');
    if (topArtistsSlider && recentlyPlayed.length > 0) {
        topArtistsSlider.innerHTML = '';
        // Count plays per artist
        const artistCounts = {};
        recentlyPlayed.forEach(s => {
            const a = s.author || 'Desconocido';
            artistCounts[a] = (artistCounts[a] || 0) + 1;
        });
        const topArtists = Object.entries(artistCounts)
            .sort(([,a],[,b]) => b - a).slice(0, 10).map(([name]) => name);
        if (topArtists.length > 0) {
            topArtists.forEach(artistName => {
                // Find best thumbnail for artist
                const artistSong = recentlyPlayed.find(s => s.author === artistName);
                const card = document.createElement('div');
                card.className = 'sp-card artist-card';
                const imgWrap = document.createElement('div');
                imgWrap.className = 'sp-card-img-wrap round';
                if (artistSong && artistSong.thumbnail) {
                    imgWrap.innerHTML = `<img src="${artistSong.thumbnail}" alt="${artistName}" class="sp-card-img">`;
                } else {
                    imgWrap.innerHTML = `<div class="sp-card-img-placeholder">${artistName.charAt(0).toUpperCase()}</div>`;
                }
                const playBtn = document.createElement('button');
                playBtn.className = 'sp-card-play';
                playBtn.setAttribute('aria-label', 'Reproducir');
                playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
                imgWrap.appendChild(playBtn);
                card.appendChild(imgWrap);
                const titleEl = document.createElement('p');
                titleEl.className = 'sp-card-title';
                titleEl.textContent = artistName;
                card.appendChild(titleEl);
                const subEl = document.createElement('p');
                subEl.className = 'sp-card-sub';
                subEl.textContent = 'Artista';
                card.appendChild(subEl);
                const handlePlay = (e) => {
                    e && e.stopPropagation();
                    const artistSongs = recentlyPlayed.filter(s => s.author === artistName);
                    if (artistSongs.length) { playlist = artistSongs; playSongAtIndex(0); }
                };
                playBtn.addEventListener('click', handlePlay);
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.sp-card-play')) return;
                    openArtistPage(artistName);
                });
                topArtistsSlider.appendChild(card);
            });
            if (topArtistsSection) topArtistsSection.style.display = 'block';
        } else {
            if (topArtistsSection) topArtistsSection.style.display = 'none';
        }
    } else if (topArtistsSection) {
        topArtistsSection.style.display = 'none';
    }

    // â”€â”€ Recently Played slider (full history as song cards) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const recentlyPlayedSlider = document.getElementById('recentlyPlayedSlider');
    const recentlyPlayedSection = document.getElementById('recentlyPlayedSection');
    if (recentlyPlayedSlider) {
        recentlyPlayedSlider.innerHTML = '';
        if (recentlyPlayed.length > 0) {
            if (recentlyPlayedSection) recentlyPlayedSection.style.display = 'block';
            recentlyPlayed.slice(0, 12).forEach((song, index) => {
                const fakePl = {
                    id: 'recent-song-' + index, name: song.title,
                    description: song.author, songs: [song], _isSong: true
                };
                const card = buildSpCard(fakePl, () => {
                    playlist = recentlyPlayed.slice();
                    playSongAtIndex(index);
                });
                recentlyPlayedSlider.appendChild(card);
            });
        } else {
            if (recentlyPlayedSection) recentlyPlayedSection.style.display = 'none';
        }
    }

    // â”€â”€ Liked Songs featured slider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const likedFeaturedSection = document.getElementById('likedFeaturedSection');
    const likedFeaturedSlider = document.getElementById('likedFeaturedSlider');
    if (likedFeaturedSlider) {
        likedFeaturedSlider.innerHTML = '';
        const likedList = getLikedSongsPlaylist();
        if (likedList.length > 0) {
            if (likedFeaturedSection) likedFeaturedSection.style.display = 'block';
            // Shuffle and show up to 12
            const shuffled = [...likedList].sort(() => Math.random() - 0.5).slice(0, 12);
            shuffled.forEach((song, i) => {
                const fakePl = {
                    id: 'liked-feat-' + i, name: song.title || song.song_title,
                    description: song.author || song.song_author, songs: [song], _isSong: true
                };
                const card = buildSpCard(fakePl, () => {
                    playlist = likedList.slice();
                    playSongAtIndex(likedList.findIndex(s => s.id === song.id || s.song_id === song.id));
                });
                likedFeaturedSlider.appendChild(card);
            });
        } else {
            if (likedFeaturedSection) likedFeaturedSection.style.display = 'none';
        }
    }

    // â”€â”€ Wire "Mostrar todo" and "Ver todo" buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('showAllRecentBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        // Expand the slider to show all (remove scroll limit)
        const slider = document.getElementById('recentlyPlayedSlider');
        if (slider) {
            recentlyPlayed.forEach((song, index) => {
                if (index >= 12) {
                    const fakePl = { id: 'recent-extra-' + index, name: song.title, description: song.author, songs: [song], _isSong: true };
                    const card = buildSpCard(fakePl, () => { playlist = recentlyPlayed.slice(); playSongAtIndex(index); });
                    slider.appendChild(card);
                }
            });
            e.target.style.display = 'none';
        }
    });
    document.getElementById('showLikedBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        openLikedSongsView();
    });

    // â”€â”€ Empty welcome state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const hasHistory = recentlyPlayed.length > 0 || getLikedSongsPlaylist().length > 0;
    const emptyWelcome = document.getElementById('homeEmptyWelcome');
    if (emptyWelcome) emptyWelcome.style.display = hasHistory ? 'none' : 'flex';
    document.getElementById('homeEmptySearchBtn')?.addEventListener('click', () => showSearchView());
    document.getElementById('showAllGenresBtn')?.addEventListener('click', (e) => { e.preventDefault(); showSearchView(); });

    // â”€â”€ Discover genre grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    buildHomeDiscoverGrid();

    // Async dynamic sections — load after paint
    loadNovedades();
    loadTendencias();
}

// -- Artistas trending fallback for new accounts ----------------------------------------
const TRENDING_ARTISTS_FALLBACK = [
    'Quevedo', 'Bad Bunny', 'Bizarrap', 'Rosala', 'Peso Pluma',
    'Rauw Alejandro', 'Feid', 'Karol G', 'Nicki Nicole', 'Morad',
    'C. Tangana', 'The Weeknd', 'Benson Boone', 'Sabrina Carpenter', 'Olivia Rodrigo'
];
const TRENDING_QUERIES_FALLBACK = [
    'hits globales 2025', 'exitos pop 2025', 'top reggaeton 2025', 'lo mas escuchado 2025'
];

function buildShimmerCard() {
    const card = document.createElement('div');
    card.className = 'sp-card shimmer-card';
    card.innerHTML = `
        <div class="shimmer-img-wrap"></div>
        <div class="shimmer-line"></div>
        <div class="shimmer-line short"></div>
    `;
    return card;
}

function buildAlbumSpCard(album) {
    const card = document.createElement('div');
    card.className = 'sp-card';
    const cover = album.thumbnail || '';
    const letter = (album.title || '?').charAt(0).toUpperCase();
    const imgWrap = document.createElement('div');
    imgWrap.className = 'sp-card-img-wrap';
    if (cover) {
        const img = document.createElement('img');
        img.src = cover; img.alt = album.title || ''; img.className = 'sp-card-img';
        img.onerror = () => { imgWrap.innerHTML = `<div class="sp-card-img-placeholder">${letter}</div>`; };
        imgWrap.appendChild(img);
    } else { imgWrap.innerHTML = `<div class="sp-card-img-placeholder">${letter}</div>`; }
    const playBtn = document.createElement('button');
    playBtn.className = 'sp-card-play';
    playBtn.setAttribute('aria-label', 'Reproducir album');
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
    imgWrap.appendChild(playBtn); card.appendChild(imgWrap);
    const titleP = document.createElement('p'); titleP.className = 'sp-card-title'; titleP.textContent = album.title || ''; card.appendChild(titleP);
    const sub = document.createElement('p'); sub.className = 'sp-card-sub'; sub.textContent = album.videoCount > 0 ? `${album.videoCount} canciones` : 'Lista'; card.appendChild(sub);
    const open = () => openAlbumView(album.id, album.title, album.thumbnail);
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    card.addEventListener('click', (e) => { if (!e.target.closest('.sp-card-play')) open(); });
    return card;
}

async function loadNovedades() {
    const section = document.getElementById('novedadesSection');
    const slider  = document.getElementById('novedadesSlider');
    const titleEl = document.getElementById('novedadesTitle');
    if (!section || !slider) return;
    const artistCounts = {};
    recentlyPlayed.forEach(s => { if (s.author) artistCounts[s.author] = (artistCounts[s.author] || 0) + 1; });
    const topArtists = Object.entries(artistCounts).sort(([,a],[,b]) => b - a).slice(0, 5).map(([n]) => n);
    const hasHistory = topArtists.length >= 2;
    // Use onboarding genre preferences if no listening history yet
    const _genrePrefs = (() => { try { return JSON.parse(localStorage.getItem('userGenrePrefs') || 'null'); } catch { return null; } })();
    const queries = hasHistory
        ? topArtists
        : (Array.isArray(_genrePrefs) && _genrePrefs.length > 0 ? _genrePrefs.slice(0, 6) : TRENDING_ARTISTS_FALLBACK.slice(0, 6));
    if (titleEl) titleEl.textContent = hasHistory ? 'Novedades de tus artistas' : 'Lanzamientos populares';
    section.style.display = 'block';
    slider.innerHTML = '';
    for (let i = 0; i < 6; i++) slider.appendChild(buildShimmerCard());
    const seen = new Set(); const albums = [];
    for (const q of queries) {
        if (albums.length >= 10) break;
        try {
            const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
            if (!res.ok) continue;
            const data = await res.json();
            for (const album of (data['Albums'] || [])) {
                if (!seen.has(album.id) && album.title) { seen.add(album.id); albums.push(album); }
                if (albums.length >= 10) break;
            }
        } catch(e) {}
    }
    slider.innerHTML = '';
    if (albums.length === 0) { section.style.display = 'none'; return; }
    albums.forEach(album => slider.appendChild(buildAlbumSpCard(album)));
}

async function loadTendencias() {
    const section = document.getElementById('tendenciasSection');
    const slider  = document.getElementById('tendenciasSlider');
    if (!section || !slider) return;
    section.style.display = 'block';
    slider.innerHTML = '';
    for (let i = 0; i < 6; i++) slider.appendChild(buildShimmerCard());
    const doy = Math.floor(Date.now() / 86400000) % TRENDING_QUERIES_FALLBACK.length;
    const query = TRENDING_QUERIES_FALLBACK[doy];
    try {
        const res = await fetch(`/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('bad');
        const data = await res.json();
        const albums = (data['Albums'] || []).slice(0, 6);
        const allSongs = Object.entries(data).filter(([k]) => k !== 'Albums').flatMap(([,v]) => v);
        slider.innerHTML = '';
        let shown = 0;
        for (const album of albums) {
            if (shown >= 8) break;
            slider.appendChild(buildAlbumSpCard(album)); shown++;
        }
        for (const song of allSongs) {
            if (shown >= 8) break;
            const fakePl = { id: 'trend-' + shown, name: song.title, description: song.author, songs: [song], _isSong: true, cover: song.thumbnail };
            const card = buildSpCard(fakePl, () => {
                setQueueAndPlayFromSongs([song], song);
            });
            slider.appendChild(card); shown++;
        }
        if (shown === 0) section.style.display = 'none';
    } catch(e) { section.style.display = 'none'; }
}

const HOME_GENRES = [
    { name: 'Pop',             color: '#E8115B', icon: 'ðŸŽµ', query: 'pop hits' },
    { name: 'Hip-Hop',         color: '#DC148C', icon: 'ðŸŽ¤', query: 'hip hop' },
    { name: 'Rock',            color: '#E91429', icon: 'ðŸŽ¸', query: 'rock classic' },
    { name: 'Electrónica',     color: '#1E3264', icon: 'ðŸŽ§', query: 'electronic dance' },
    { name: 'Reggaetón',       color: '#8D67AB', icon: 'ðŸ”¥', query: 'reggaeton' },
    { name: 'R&B',             color: '#503750', icon: 'ðŸŽ·', query: 'r&b soul' },
    { name: 'Indie',           color: '#477D95', icon: 'ðŸŽ¶', query: 'indie alternative' },
    { name: 'Latino',          color: '#DF4E12', icon: 'ðŸ’ƒ', query: 'latin pop' },
    { name: 'Metal',           color: '#1F1F1F', icon: 'ðŸ¤˜', query: 'heavy metal' },
    { name: 'Jazz',            color: '#1B6B50', icon: 'ðŸŽº', query: 'jazz' },
    { name: 'Clásica',         color: '#3D3D3D', icon: 'ðŸŽ»', query: 'classical music' },
    { name: 'K-Pop',           color: '#FF5DA0', icon: 'â­', query: 'kpop hits' },
];

function buildHomeDiscoverGrid() {
    const grid = document.getElementById('discoverGenreGrid');
    if (!grid || grid.childElementCount > 0) return;
    HOME_GENRES.forEach(genre => {
        const card = document.createElement('div');
        card.className = 'discover-genre-card';
        card.style.backgroundColor = genre.color;
        card.innerHTML = `
            <span class="discover-genre-name">${genre.name}</span>
            <span class="discover-genre-icon">${genre.icon}</span>
        `;
        card.addEventListener('click', () => {
            const si = document.getElementById('searchInput');
            if (si) {
                si.value = genre.query;
                const clearBtn = document.getElementById('clearSearchBtn');
                if (clearBtn) clearBtn.style.display = 'flex';
            }
            showSearchView();
            searchSongs(genre.query);
        });
        grid.appendChild(card);
    });
}

// Build a portrait Spotify-style card for a playlist or song
function buildSpCard(pl, customClickHandler) {
    const card = document.createElement('div');
    card.className = 'sp-card';
    if (pl.id) card.dataset.plId = pl.id;

    // Determine cover image
    const cover = pl.cover
        || (pl.songs && pl.songs.length > 0 && pl.songs[0] && pl.songs[0].thumbnail)
        || null;
    const letter = (pl.name || '?').charAt(0).toUpperCase();

    const imgWrap = document.createElement('div');
    imgWrap.className = 'sp-card-img-wrap';
    if (cover) {
        const img = document.createElement('img');
        img.src = cover;
        img.alt = pl.name || '';
        img.className = 'sp-card-img';
        img.onerror = () => {
            imgWrap.innerHTML = `<div class="sp-card-img-placeholder">${letter}</div>`;
        };
        imgWrap.appendChild(img);
    } else {
        const ph = document.createElement('div');
        ph.className = 'sp-card-img-placeholder';
        ph.textContent = letter;
        imgWrap.appendChild(ph);
    }

    const playBtn = document.createElement('button');
    playBtn.className = 'sp-card-play';
    playBtn.setAttribute('aria-label', 'Reproducir');
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>`;
    imgWrap.appendChild(playBtn);
    card.appendChild(imgWrap);

    const title = document.createElement('p');
    title.className = 'sp-card-title';
    title.textContent = pl.name || 'Sin título';
    card.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'sp-card-sub';
    const songCount = (pl.songs || []).length;
    if (pl._isSong) {
        sub.textContent = pl.description || '';
    } else {
        sub.textContent = pl.description || (songCount > 0 ? `${songCount} canciones` : 'Sin canciones');
    }
    card.appendChild(sub);

    // Click handler
    const handlePlay = (e) => {
        e && e.stopPropagation();
        if (customClickHandler) { customClickHandler(); return; }
        if (!Array.isArray(pl.songs) || pl.songs.length === 0) return;
        playlist = dedupeSongsByTitle(pl.songs);
        playSongAtIndex(0);
    };
    const handleOpen = (e) => {
        if (e.target.closest('.sp-card-play')) return;
        if (customClickHandler) { customClickHandler(); return; }
        openPlaylistFromHome(pl);
    };

    playBtn.addEventListener('click', handlePlay);
    card.addEventListener('click', handleOpen);

    return card;
}

// Open a playlist from home cards into the full playlist view
// Track which MFY playlist is open so async fetches can update it
window._openMFYPlaylistId = null;

// Called by async loaders when real songs arrive — refreshes song list if that playlist is open
function _refreshPlaylistViewIfOpen(id, songs) {
    if (window._openMFYPlaylistId !== id) return;
    const playlistView = document.getElementById('playlistView');
    if (!playlistView || playlistView.style.display === 'none') return;
    // Update song count in header
    const countEl = playlistView.querySelector('.artist-listeners');
    if (countEl) countEl.textContent = `${songs.length} canciones \u2022 Esplotify`;
    // Rebuild songs list
    const existing = playlistView.querySelector('.popular-songs');
    if (!existing) return;
    const list = existing.querySelector('.popular-list');
    if (list) list.innerHTML = '';
    const h2 = existing.querySelector('h2');
    const newList = document.createElement('div');
    newList.className = 'popular-list';
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
        newList.appendChild(row);
    });
    existing.innerHTML = '';
    if (h2) existing.appendChild(h2); else existing.innerHTML = '<h2 style="padding:24px 0 16px;font-size:22px;font-weight:700;">Canciones</h2>';
    existing.appendChild(newList);
    // Update play-all button
    const playAllBtn = playlistView.querySelector('.play-all-btn');
    if (playAllBtn) playAllBtn.onclick = () => {
        const queueSongs = dedupeSongsByTitle(songs);
        if (queueSongs.length > 0) { playlist = queueSongs; playSongAtIndex(0); }
    };
}

function openPlaylistFromHome(pl) {
    window._isSearchPlaylist = false;
    // Always read the latest version from localStorage (async load may have updated it)
    if (pl.id) {
        const stored = loadMadeForYouPlaylists() || [];
        const fresh = stored.find(p => p.id === pl.id);
        if (fresh) pl = { ...pl, ...fresh };
    }
    // Track which MFY playlist is open
    window._openMFYPlaylistId = pl.id || null;

    document.getElementById('searchView').style.display = 'none';
    document.getElementById('libraryView').style.display = 'none';
    document.getElementById('homeView').style.display = 'none';

    const playlistView = document.getElementById('playlistView');
    playlistView.style.display = 'block';
    playlistView.innerHTML = '';

    const headerImage = (pl.songs && pl.songs.length > 0 && pl.songs[0].thumbnail) ? pl.songs[0].thumbnail : '';

    const backBtn = document.createElement('button');
    backBtn.className = 'back-button';
    backBtn.textContent = '← Volver';
    backBtn.onclick = () => { window._openMFYPlaylistId = null; playlistView.style.display = 'none'; document.getElementById('homeView').style.display = 'block'; };
    playlistView.appendChild(backBtn);

    const header = document.createElement('div');
    header.className = 'artist-header-large';
    if (headerImage) header.style.backgroundImage = `url(${headerImage})`;
    header.innerHTML = `
        <div class="artist-header-overlay"></div>
        <div class="artist-header-content">
            <div class="artist-verified">
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#1DB954" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
                Lista de reproducción
            </div>
            <h1 class="artist-name-large">${(pl.name || '').toUpperCase()}</h1>
            <p class="artist-listeners">${(pl.songs || []).length} canciones • ${pl.owner || 'Esplotify'}</p>
            ${pl.description ? `<p style="color:#b3b3b3;font-size:14px;margin-top:4px;">${pl.description}</p>` : ''}
        </div>
    `;
    playlistView.appendChild(header);

    const controls = document.createElement('div');
    controls.className = 'artist-control-bar';
    controls.innerHTML = `
        <button class="play-all-btn">
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
        </button>
        ${headerImage ? `<img src="${headerImage}" alt="${pl.name}" class="album-cover-small">` : ''}
    `;
    controls.querySelector('.play-all-btn').addEventListener('click', () => {
        if (!pl.songs || pl.songs.length === 0) return;
        playlist = dedupeSongsByTitle(pl.songs);
        playSongAtIndex(0);
    });
    playlistView.appendChild(controls);

    const songsList = document.createElement('div');
    songsList.className = 'popular-songs';
    songsList.style.padding = '0 32px';
    const songsToShow = pl.songs || [];
    if (songsToShow.length === 0) {
        songsList.innerHTML = `<h2 style="padding:24px 0 16px;font-size:22px;font-weight:700;">Canciones</h2><div style="display:flex;align-items:center;gap:12px;padding:24px 0;color:#b3b3b3"><svg width="24" height="24" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><path fill="#1DB954" d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>Cargando canciones...</div>`;
    } else {
        songsList.innerHTML = `<h2 style="padding:24px 0 16px;font-size:22px;font-weight:700;">Canciones</h2>`;
    }
    const list = document.createElement('div');
    list.className = 'popular-list';
    songsToShow.forEach((song, index) => {
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
            if (!e.target.closest('.song-actions')) setQueueAndPlayFromSongs(songsToShow, song);
        });
        list.appendChild(row);
    });
    songsList.appendChild(list);
    playlistView.appendChild(songsList);
}

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
            clearTimeout(searchTimeout);
            cancelInFlightSearch();
            pendingSearchRender = null;
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

// Función pública para regenerar la playlist Descubrimiento Semanal inmediatamente
async function refreshDiscoveryNow() {
    try {
        // Construir la lista de artistas desde recentlyPlayed
        const playedSongIds = new Set(recentlyPlayed.map(s => s.id));
        const artistCounts = {};
        recentlyPlayed.forEach(song => {
            artistCounts[song.author] = (artistCounts[song.author] || 0) + 1;
        });
        const allArtists = Object.keys(artistCounts);

        // Buscar canciones no reproducidas por artista
        const artistSongs = await Promise.all(allArtists.map(async artist => {
            try {
                const response = await fetch(`/search?q=${encodeURIComponent(artist)}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                return (data.Canciones || []).filter(song => song.author === artist && !playedSongIds.has(song.id));
            } catch (e) {
                console.error('Error fetching songs for', artist, e);
                return [];
            }
        }));

        const allUnplayed = artistSongs.flat();
        const shuffled = allUnplayed.sort(() => Math.random() - 0.5).slice(0, 50);

        const weeklyDiscover = {
            id: DISCOVERY_ID,
            name: 'Descubrimiento Semanal',
            description: 'Nuevas canciones basadas en tu historial de reproducción',
            songs: shuffled,
            owner: 'Esplotify',
            lastUpdated: Date.now()
        };

        const current = loadMadeForYouPlaylists() || [];
        const idx = current.findIndex(p => p.id === DISCOVERY_ID);
        if (idx > -1) {
            current[idx] = { ...current[idx], ...weeklyDiscover };
        } else {
            current.push(weeklyDiscover);
        }
        saveMadeForYouPlaylists(current);
        populateHomeCards();

        // Sync al backend
        syncAutoPlaylistToDB(weeklyDiscover);

        return weeklyDiscover;
    } catch (err) {
        console.error('Error en refreshDiscoveryNow:', err);
        throw err;
    }
}

// Formatear timestamp a texto relativo (hoy / hace X días / fecha)
function formatRelativeDate(timestamp) {
    if (!timestamp) return 'Nunca actualizado';
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (days <= 0) return 'Hoy';
    if (days === 1) return 'Hace 1 día';
    if (days < 7) return `Hace ${days} días`;
    // Si es mayor, mostrar fecha local breve
    try {
        return new Date(timestamp).toLocaleDateString();
    } catch (e) {
        return new Date(timestamp).toString();
    }
}
