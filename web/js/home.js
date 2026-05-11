// ============================================================================
// home.js - Home View Management Module
// ============================================================================
// Handles home page generation, recommendations, and rendering
// - Mix Diario (Daily Mix)
// - Descubrimiento Semanal (Weekly Discovery)
// - Radar de Novedades (New Releases)
// - Home cards, sliders, and genre tiles
// ============================================================================

(function(global) {
    'use strict';

    // Constants
    const DISCOVERY_ID = 'descubrimiento-semanal';
    const DISCOVERY_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

    const TRENDING_ARTISTS_FALLBACK = [
        'Quevedo', 'Bad Bunny', 'Bizarrap', 'Rosalía', 'Peso Pluma',
        'Rauw Alejandro', 'Feid', 'Karol G', 'Nicki Nicole', 'Morad',
        'C. Tangana', 'The Weeknd', 'Benson Boone', 'Sabrina Carpenter', 'Olivia Rodrigo'
    ];

    const TRENDING_QUERIES_FALLBACK = [
        'hits globales 2025', 'exitos pop 2025', 'top reggaeton 2025', 'lo mas escuchado 2025'
    ];

    const HOME_GENRES = [
        { name: 'Pop',             color: '#E8115B', icon: '🎵', query: 'pop hits' },
        { name: 'Hip-Hop',         color: '#DC148C', icon: '🎤', query: 'hip hop' },
        { name: 'Rock',            color: '#E91429', icon: '🎸', query: 'rock classic' },
        { name: 'Electrónica',     color: '#1E3264', icon: '🎧', query: 'electronic dance' },
        { name: 'Reggaetón',       color: '#8D67AB', icon: '🔥', query: 'reggaeton' },
        { name: 'R&B',             color: '#503750', icon: '🎷', query: 'r&b soul' },
        { name: 'Indie',           color: '#477D95', icon: '🎶', query: 'indie alternative' },
        { name: 'Latino',          color: '#DF4E12', icon: '💃', query: 'latin pop' },
        { name: 'Metal',           color: '#1F1F1F', icon: '🤘', query: 'heavy metal' },
        { name: 'Jazz',            color: '#1B6B50', icon: '🎺', query: 'jazz' },
        { name: 'Clásica',         color: '#3D3D3D', icon: '🎻', query: 'classical music' },
        { name: 'K-Pop',           color: '#FF5DA0', icon: '⭐', query: 'kpop hits' },
    ];

    function createHomeModule(deps) {
        // Dependencies
        const {
            getRecentlyPlayed,
            getLikedSongsPlaylist,
            getPlaylist,
            setPlaylist,
            playSongAtIndex,
            getCurrentIndex,
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
            fetchImpl,
        } = deps;

        // ─── Generate Recommendations ───────────────────────────────────────────
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
                            const res = await fetchImpl(`/search?q=${encodeURIComponent(q)}`);
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
                                const response = await fetchImpl(`/search?q=${encodeURIComponent(artist)}`);
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
                            const res = await fetchImpl('/search?q=' + encodeURIComponent(q));
                            if (!res.ok) continue;
                            const data = await res.json();
                            const albums = data['Albums'] || [];
                            if (albums.length > 0) {
                                const albumRes = await fetchImpl('/album?id=' + encodeURIComponent(albums[0].id));
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

        // ─── Populate Home Cards ─────────────────────────────────────────────────
        function populateHomeCards() {
            const recentlyPlayed = getRecentlyPlayed();
            
            // ── Greeting (time-based) + dynamic gradient ────────────────────────
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

            // ── Recently played — compact 3×2 tile grid ─────────────────────────
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
                            setPlaylist([song]);
                            playSongAtIndex(0);
                        };
                        playBtn.addEventListener('click', play);
                        tile.addEventListener('click', play);
                        recentGrid.appendChild(tile);
                    });
                }
            }

            // ── Jump back in — last 6 distinct songs ────────────────────────────
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
                        setPlaylist([song]);
                        playSongAtIndex(0);
                    });
                    jumpBackSlider.appendChild(card);
                });
                if (jumpBackSection) jumpBackSection.style.display = 'block';
            } else if (jumpBackSection) {
                jumpBackSection.style.display = 'none';
            }

            // ── Made For You slider ──────────────────────────────────────────────
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
                                updateBtn.textContent = 'Actualizando…';
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

            // ── Top Artists slider ───────────────────────────────────────────────
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
                            if (artistSongs.length) { setPlaylist(artistSongs); playSongAtIndex(0); }
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

            // ── Recently Played slider (full history as song cards) ─────────────
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
                            setPlaylist(recentlyPlayed.slice());
                            playSongAtIndex(index);
                        });
                        recentlyPlayedSlider.appendChild(card);
                    });
                } else {
                    if (recentlyPlayedSection) recentlyPlayedSection.style.display = 'none';
                }
            }

            // ── Liked Songs featured slider ──────────────────────────────────────
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
                            setPlaylist(likedList.slice());
                            playSongAtIndex(likedList.findIndex(s => s.id === song.id || s.song_id === song.id));
                        });
                        likedFeaturedSlider.appendChild(card);
                    });
                } else {
                    if (likedFeaturedSection) likedFeaturedSection.style.display = 'none';
                }
            }

            // ── Wire "Mostrar todo" and "Ver todo" buttons ──────────────────────
            document.getElementById('showAllRecentBtn')?.addEventListener('click', (e) => {
                e.preventDefault();
                // Expand the slider to show all (remove scroll limit)
                const slider = document.getElementById('recentlyPlayedSlider');
                if (slider) {
                    recentlyPlayed.forEach((song, index) => {
                        if (index >= 12) {
                            const fakePl = { id: 'recent-extra-' + index, name: song.title, description: song.author, songs: [song], _isSong: true };
                            const card = buildSpCard(fakePl, () => { setPlaylist(recentlyPlayed.slice()); playSongAtIndex(index); });
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

            // ── Empty welcome state ──────────────────────────────────────────────
            const hasHistory = recentlyPlayed.length > 0 || getLikedSongsPlaylist().length > 0;
            const emptyWelcome = document.getElementById('homeEmptyWelcome');
            if (emptyWelcome) emptyWelcome.style.display = hasHistory ? 'none' : 'flex';
            document.getElementById('homeEmptySearchBtn')?.addEventListener('click', () => showSearchView());
            document.getElementById('showAllGenresBtn')?.addEventListener('click', (e) => { e.preventDefault(); showSearchView(); });

            // ── Discover genre grid ──────────────────────────────────────────────
            buildHomeDiscoverGrid();

            // Async dynamic sections — load after paint
            loadNovedades();
            loadTendencias();
        }

        // ─── Load Novedades (New Releases) ───────────────────────────────────────
        async function loadNovedades() {
            const recentlyPlayed = getRecentlyPlayed();
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
                    const res = await fetchImpl(`/search?q=${encodeURIComponent(q)}`);
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

        // ─── Load Tendencias (Trending) ──────────────────────────────────────────
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
                const res = await fetchImpl(`/search?q=${encodeURIComponent(query)}`);
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

        // ─── Build Home Discover Grid ────────────────────────────────────────────
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
                    const searchModule = window.EsplotifySearch;
                    if (searchModule && searchModule.searchSongs) {
                        searchModule.searchSongs(genre.query);
                    }
                });
                grid.appendChild(card);
            });
        }

        // ─── Build Spotify-style Card ────────────────────────────────────────────
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
                setPlaylist(dedupeSongsByTitle(pl.songs));
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

        // ─── Build Shimmer Loading Card ──────────────────────────────────────────
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

        // ─── Build Album Card ────────────────────────────────────────────────────
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

        // ─── Refresh Playlist View If Open ───────────────────────────────────────
        function _refreshPlaylistViewIfOpen(id, songs) {
            if (window._openMFYPlaylistId !== id) return;
            const playlistView = document.getElementById('playlistView');
            if (!playlistView || playlistView.style.display === 'none') return;
            // Update song count in header
            const countEl = playlistView.querySelector('.artist-listeners');
            if (countEl) countEl.textContent = `${songs.length} canciones • Esplotify`;
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
                if (queueSongs.length > 0) { setPlaylist(queueSongs); playSongAtIndex(0); }
            };
        }

        // ─── Open Playlist From Home ─────────────────────────────────────────────
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

            // Play all button
            const controls = document.createElement('div');
            controls.className = 'artist-controls';
            const playAllBtn = document.createElement('button');
            playAllBtn.className = 'play-all-btn';
            playAllBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
            playAllBtn.onclick = () => {
                const queueSongs = dedupeSongsByTitle(pl.songs || []);
                if (queueSongs.length > 0) { setPlaylist(queueSongs); playSongAtIndex(0); }
            };
            controls.appendChild(playAllBtn);
            playlistView.appendChild(controls);

            // Songs list
            const songsSection = document.createElement('div');
            songsSection.className = 'popular-songs';
            songsSection.innerHTML = '<h2 style="padding:24px 0 16px;font-size:22px;font-weight:700;">Canciones</h2>';
            const songsList = document.createElement('div');
            songsList.className = 'popular-list';
            (pl.songs || []).forEach((song, index) => {
                const row = document.createElement('div');
                row.className = 'popular-song-item';
                row.setAttribute('data-index', index);
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
                    if (!e.target.closest('.song-actions')) {
                        setQueueAndPlayFromSongs(pl.songs, song);
                    }
                });
                songsList.appendChild(row);
            });
            songsSection.appendChild(songsList);
            playlistView.appendChild(songsSection);
        }

        // ─── Refresh Discovery Now ───────────────────────────────────────────────
        async function refreshDiscoveryNow() {
            try {
                const recentlyPlayed = getRecentlyPlayed();
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
                        const response = await fetchImpl(`/search?q=${encodeURIComponent(artist)}`);
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

        // ─── Format Relative Date ────────────────────────────────────────────────
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

        // ─── API ─────────────────────────────────────────────────────────────────
        return {
            populateHomeCards,
            refreshDiscoveryNow,
            openPlaylistFromHome,
        };
    }

    // Export to global scope
    global.EsplotifyHome = {
        createHomeModule,
    };

})(window);
