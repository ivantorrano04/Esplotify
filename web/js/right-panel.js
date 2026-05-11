// Esplotify Right Panel Module
// Handles right panel (queue, lyrics, now playing) logic
// Exports: createRightPanelModule({ ...deps })

(function (global) {
    function createRightPanelModule({
        getCurrentSong,
        getPlaylist,
        getCurrentIndex,
        getCurrentAudio,
        getLikedSongs,
        setLikedSongs,
        isLoading,
        setIsLoading,
        formatDuration,
        openSongContextMenu,
        playSongAtIndex,
        toggleLike,
        loadMadeForYouPlaylists,
        saveMadeForYouPlaylists,
        fetchImpl,
        normalizeSongTitle,
        prefetchSongs,
    }) {
        let currentLyrics = [];
        let currentLyricIndex = -1;
        let isLyricsPanelOpen = false;
        let lyricsAutoScroll = true;
        let lyricsOffset = 0; // segundos de retraso para compensar intros del video

        function updateLyrics(currentTime) {
            if (!currentLyrics || !currentLyrics.length) return;

            // Ajustar el tiempo con el offset de sincronización (compensar intro del video)
            const adjustedTime = currentTime - lyricsOffset;

            // Reverse scan: find the last line whose timestamp <= adjustedTime
            let newIndex = -1;
            for (let i = currentLyrics.length - 1; i >= 0; i--) {
                if (adjustedTime >= currentLyrics[i].time) {
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

        function scrollToLyric(index) {
            const currentLine = document.querySelector(`#lyricsText [data-index="${index}"]`);
            if (!currentLine || !lyricsAutoScroll) return;
            const container = document.querySelector('#rpLyricsPane .lyrics-content');
            if (!container) return;
            const targetScroll = currentLine.offsetTop - container.clientHeight * 0.38;
            container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
        }

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
            if (!panel) return;

            let isOpen     = false;
            let activeTab  = 'queue';
            let lyricsLoaded = null;

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
                lyricsLoaded = null;                    lyricsOffset = 0;            }

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

                const currentSong = getCurrentSong();
                if (isQueue) {
                    renderQueue();
                } else if (isLyrics && currentSong && lyricsLoaded !== currentSong.id) {
                    loadAndDisplayLyrics(currentSong.id, currentSong.title, currentSong.author);
                } else if (isLyrics && currentSong && lyricsLoaded === currentSong.id) {
                    // Letras ya cargadas: actualizar línea activa y hacer scroll a la posición actual
                    const currentAudio = getCurrentAudio();
                    const nowTime = currentAudio ? currentAudio.currentTime : 0;
                    updateLyrics(nowTime);
                    // Forzar el scroll aunque currentLyricIndex no haya cambiado
                    if (currentLyricIndex >= 0) {
                        setTimeout(() => scrollToLyric(currentLyricIndex), 50);
                    }
                } else if (isNowPlaying) {
                    renderNowPlaying();
                }
            }

            function extractDominantColor(imgEl, callback) {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 8; canvas.height = 8;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(imgEl, 0, 0, 8, 8);
                    const d = ctx.getImageData(0, 0, 8, 8).data;
                    let r = 0, g = 0, b = 0, count = 0;
                    for (let i = 0; i < d.length; i += 4) {
                        const brightness = (d[i] + d[i+1] + d[i+2]) / 3;
                        if (brightness < 20 || brightness > 230) continue;
                        r += d[i]; g += d[i+1]; b += d[i+2]; count++;
                    }
                    if (count === 0) { callback('#1a1a2e', '#2d2d6b'); return; }
                    r = Math.round(r / count);
                    g = Math.round(g / count);
                    b = Math.round(b / count);
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
                    const response = await fetchImpl(
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
                const currentSong = getCurrentSong();
                const currentIndex = getCurrentIndex();
                const playlist = getPlaylist();
                const currentAudio = getCurrentAudio();
                const likedSongs = getLikedSongs();

                if (!nowPlayingPane) return;
                const npvBg            = document.getElementById('npvBg');
                const npvArt           = document.getElementById('npvArt');
                const npvArtWrap       = document.getElementById('npvArtWrap');
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
                    const status = isLoading()
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

                if (npvTitle) npvTitle.textContent = currentSong.title || 'Sin título';
                if (npvArtistEl) npvArtistEl.textContent = currentSong.author || '';
                loadSongInsights(currentSong);

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

                if (npvAddBtn) {
                    npvAddBtn.onclick = () => {
                        const addBtn = document.getElementById('addToPlaylistBtn');
                        if (addBtn) addBtn.click();
                    };
                }

                if (npvMoreBtn && currentSong) {
                    npvMoreBtn.onclick = () => {
                        openSongContextMenu(currentSong, npvMoreBtn);
                    };
                }

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

            function renderQueue() {
                const currentSong = getCurrentSong();
                const playlist = getPlaylist();
                const currentIndex = getCurrentIndex();

                const nowRow    = document.getElementById('rpNowRow');
                const queueList = document.getElementById('rpQueueList');
                const nextSec   = document.getElementById('rpNextSection');
                if (!nowRow || !queueList) return;

                if (currentSong) {
                    nowRow.innerHTML = buildQueueRowHTML(currentSong, true);
                } else {
                    nowRow.innerHTML = '<p class="rp-empty">Ninguna canción reproduciéndose</p>';
                }

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
                        const pl = getPlaylist();
                        const [moved] = pl.splice(offset + dragSrcIdx, 1);
                        pl.splice(offset + destIdx, 0, moved);
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

            async function loadAndDisplayLyrics(songId, songTitle, artist) {
                const lyricsText = document.getElementById('lyricsText');
                if (!lyricsText) return;

                // Cargar offset guardado para esta canción
                lyricsOffset = parseInt(localStorage.getItem(`lyricsOffset_${songId}`) || '0');
                updateOffsetDisplay();

                lyricsText.innerHTML = '<div class="lyrics-line" style="opacity:0.5;font-size:18px;">Cargando letra…</div>';
                try {
                    const params = new URLSearchParams({ id: songId });
                    if (artist)    params.set('artist', artist);
                    if (songTitle) params.set('title', songTitle);
                    const response = await fetchImpl(`/lyrics?${params.toString()}`);
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

                        if (data.plainText) {
                            const currentSong = getCurrentSong();
                            const dur = (currentSong && currentSong.duration) ? currentSong.duration : 210;
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
                                const currentAudio = getCurrentAudio();
                                if (currentAudio && el.dataset.time) {
                                    // Saltar al tiempo de la línea ajustado por el offset
                                    currentAudio.currentTime = parseInt(el.dataset.time) + lyricsOffset;
                                    highlightCurrentLyric(parseInt(el.dataset.index));
                                    scrollToLyricInPanel(parseInt(el.dataset.index));
                                }
                            });
                        });
                        const currentAudio = getCurrentAudio();
                        const nowTime = currentAudio ? currentAudio.currentTime : 0;
                        currentLyricIndex = -1;
                        updateLyrics(nowTime);
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
                const targetScroll = el.offsetTop - container.clientHeight * 0.38;
                container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
            }

            function updateOffsetDisplay() {
                const valueEl = document.getElementById('lyricsOffsetValue');
                if (!valueEl) return;
                const s = lyricsOffset;
                valueEl.textContent = s === 0 ? '0s' : (s > 0 ? `+${s}s` : `${s}s`);
                valueEl.classList.toggle('at-zero', s === 0);
            }

            function applyOffsetDelta(delta) {
                lyricsOffset += delta;
                const song = getCurrentSong();
                if (song) localStorage.setItem(`lyricsOffset_${song.id}`, lyricsOffset);
                updateOffsetDisplay();
                // Re-evaluar línea activa inmediatamente
                const audio = getCurrentAudio();
                if (audio) {
                    const prevIndex = currentLyricIndex;
                    currentLyricIndex = -1; // forzar re-evaluación
                    updateLyrics(audio.currentTime);
                    if (currentLyricIndex < 0) currentLyricIndex = prevIndex; // restaurar si no cambió
                    if (currentLyricIndex >= 0 && lyricsAutoScroll) scrollToLyricInPanel(currentLyricIndex);
                }
            }

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

            const playerThumb = document.getElementById('playerThumbnail');
            playerThumb && playerThumb.addEventListener('click', () => {
                if (isOpen && activeTab === 'nowplaying') closePanel();
                else openPanel('nowplaying');
            });

            rpTabQueue      && rpTabQueue.addEventListener('click', () => switchTab('queue'));
            rpTabLyrics     && rpTabLyrics.addEventListener('click', () => switchTab('lyrics'));
            rpTabNowPlaying && rpTabNowPlaying.addEventListener('click', () => switchTab('nowplaying'));
            rpClose && rpClose.addEventListener('click', closePanel);

            // Botones de offset de sincronización de letras
            document.querySelectorAll('.lyrics-offset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const delta = parseInt(btn.dataset.delta || '0');
                    if (delta) applyOffsetDelta(delta);
                });
            });
            const offsetResetBtn = document.getElementById('lyricsOffsetReset');
            offsetResetBtn && offsetResetBtn.addEventListener('click', () => {
                lyricsOffset = 0;
                const song = getCurrentSong();
                if (song) localStorage.removeItem(`lyricsOffset_${song.id}`);
                updateOffsetDisplay();
                const audio = getCurrentAudio();
                if (audio) { currentLyricIndex = -1; updateLyrics(audio.currentTime); }
            });

            updateOffsetDisplay();

            window._rpScrollToLyric = scrollToLyricInPanel;
            window._rpRenderNowPlaying = renderNowPlaying;
            window._rpRenderQueue = renderQueue;
            window._rpOpenPanel = openPanel;
            // Permite precargar letras desde script.js cuando empieza una canción
            window._rpPreloadLyrics = (songId, title, artist) => {
                if (lyricsLoaded === songId) return; // ya cargadas para esta canción
                loadAndDisplayLyrics(songId, title, artist);
            };
            // Getter para que script.js pueda saber si el panel de letras está abierto
            window._rpIsLyricsOpen = () => isLyricsPanelOpen;
        }

        return {
            initRightPanel,
            updateLyrics,
            highlightCurrentLyric,
            scrollToLyric,
        };
    }
    global.EsplotifyRightPanel = { createRightPanelModule };
})(window);