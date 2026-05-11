/**
 * ========================================
 * MÓDULO DE CONTROLES DEL REPRODUCTOR - Esplotify
 * ========================================
 * Propósito: Gestiona todos los controles del reproductor de audio
 * 
 * Funcionalidades:
 * - Play/Pausa
 * - Siguiente/Anterior (con doble-click para reiniciar)
 * - Shuffle (aleatorio)
 * - Repeat (repetir: off/all/one)
 * - Barra de progreso con drag y click
 * - Control de volumen con drag
 * - Atajos de teclado (Espacio, flechas, M)
 * - Auto-update de progreso
 * - Sincronización con letra y cola
 * 
 * Exports:
 * - initControls: Inicializa todos los controles
 * - updatePlayPauseIcon: Actualiza icono play/pausa
 * - updateProgress: Actualiza barra de progreso
 * - nextSong: Reproduce siguiente canción
 * - prevSong: Reproduce canción anterior
 */
// Esplotify Player Controls Module
// Handles play/pause, progress bar, volume, skip buttons, and audio event listeners
// Exports: createPlayerControlsModule({ ...deps })

(function (global) {
    function createPlayerControlsModule({
        getCurrentAudio,
        setCurrentAudio,
        getCurrentSong,
        setCurrentSong,
        getPlaylist,
        getCurrentIndex,
        setCurrentIndex,
        isLoading,
        setIsLoading,
        getRecentlyPlayed,
        setRecentlyPlayed,
        formatDuration,
        saveRecentlyPlayed,
        updateStoredRecientesPlaylist,
        updateLikeButton,
        openAddToPlaylistModal,
        updatePlayingRow,
        updateLyrics,
        normalizeSongTitle,
    }) {
        // ========================================
        // ELEMENTOS DEL DOM
        // ========================================
        // DOM elements
        const playPauseBtn = document.getElementById('playPauseBtn');
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        const progressContainer = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        const progressThumb = document.getElementById('progressThumb');
        const progressTooltip = document.getElementById('progressTooltip');
        const currentTimeEl = document.getElementById('currentTime');
        const durationEl = document.getElementById('duration');
        const volumeBtn = document.getElementById('volBtn');
        const volumeBar = document.getElementById('volumeBar');
        const volumeFill = document.getElementById('volumeFill');
        const volumeThumb = document.getElementById('volumeThumb');
        const shuffleBtn = document.getElementById('shuffleBtn');
        const repeatBtn = document.getElementById('repeatBtn');
        const player = document.getElementById('player');

        // ========================================
        // ESTADO DEL MÓDULO
        // ========================================
        // State
        let isShuffled = false;          // ¿Modo aleatorio activado?
        let isRepeated = false;          // ¿Modo repetir activado? (false/all/one)
        let isDragging = false;          // ¿Arrastrando barra de progreso?
        let isSeeking = false;           // ¿Buscando posición en el audio?
        let isVolumeDragging = false;    // ¿Arrastrando control de volumen?
        let currentVolume = 0.7;         // Volumen actual (0.0 - 1.0)
        let lastPrevPress = 0;           // Timestamp del último click en "anterior"
        let isLyricsPanelOpen = false;   // ¿Panel de letra abierto?

        // ========================================
        // ACTUALIZACIÓN DE UI
        // ========================================
        
        /**
         * Actualiza el icono del botón play/pausa según el estado actual
         * - Si no hay audio o está pausado → muestra icono de play (triángulo)
         * - Si está reproduciéndose → muestra icono de pausa (dos barras)
         */
        // Update play/pause icon
        function updatePlayPauseIcon() {
            const currentAudio = getCurrentAudio();
            const icon = playPauseBtn.querySelector('svg');
            if (!icon) return;
            
            if (!currentAudio || currentAudio.paused || isLoading()) {
                // Icono de play (triángulo)
                icon.innerHTML = '<path d="M8 5v14l11-7z" fill="currentColor"/>';
            } else {
                // Icono de pausa (dos barras)
                icon.innerHTML = '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" fill="currentColor"/>';
            }
        }

        /**
         * Actualiza la barra de progreso según el tiempo actual del audio
         * No actualiza si el usuario está arrastrando o buscando
         */
        // Update progress bar
        function updateProgress() {
            const currentAudio = getCurrentAudio();
            if (!currentAudio || isDragging || isSeeking) return;
            
            // Calcula el porcentaje de progreso
            const progress = (currentAudio.currentTime / currentAudio.duration) * 100;
            progressFill.style.width = `${progress}%`;
            if (progressThumb) progressThumb.style.left = `${progress}%`;
            currentTimeEl.textContent = formatDuration(Math.floor(currentAudio.currentTime));
        }

        /**
         * Actualiza la posición de la barra de progreso durante drag o hover
         * Muestra tooltip con el tiempo correspondiente
         * @param {Event} e - Evento del mouse
         */
        function updateSeekPosition(e) {
            const currentAudio = getCurrentAudio();
            if (!currentAudio) return;
            
            const rect = progressContainer.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
            
            // Actualiza visualmente la barra
            progressFill.style.width = `${percentage * 100}%`;
            if (progressThumb) progressThumb.style.left = `${percentage * 100}%`;
            
            // Muestra tooltip con el tiempo
            const time = percentage * currentAudio.duration;
            progressTooltip.textContent = formatDuration(Math.floor(time));
            progressTooltip.style.left = `${mouseX}px`;
            progressTooltip.style.opacity = '1';
        }

        // ========================================
        // CONTROL DE VOLUMEN
        // ========================================
        
        /**
         * Actualiza el volumen según la posición del mouse en la barra
         * @param {Event} e - Evento del mouse
         */
        // Volume control
        function updateVolumePosition(e) {
            const currentAudio = getCurrentAudio();
            if (!currentAudio) return;
            
            const rect = volumeBar.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
            
            // Aplica el volumen al audio
            currentAudio.volume = percentage;
            currentVolume = percentage;
            volumeFill.style.width = `${percentage * 100}%`;
            if (volumeThumb) volumeThumb.style.left = `${percentage * 100}%`;
            updateVolumeIcon(percentage === 0);
        }

        /**
         * Actualiza el icono de volumen según el nivel actual
         * @param {boolean} isMuted - Si el volumen está silenciado
         */
        function updateVolumeIcon(isMuted) {
            const currentAudio = getCurrentAudio();
            const icon = volumeBtn.querySelector('svg path');
            if (!icon) return;
            const volume = currentAudio ? currentAudio.volume : 0.7;
            
            // Cambia el icono según el nivel de volumen
            if (isMuted || volume === 0) {
                // Icono de mute (tachado)
                icon.setAttribute('d', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
            } else if (volume < 0.33) {
                // Volumen bajo
                icon.setAttribute('d', 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM12 4L9.91 6.09 12 8.18V4z M4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3z');
            } else if (volume < 0.66) {
                // Volumen medio
                icon.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z');
            } else {
                // Volumen alto
                icon.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z');
            }
        }

        // ========================================
        // NAVEGACIÓN DE CANCIONES
        // ========================================
        
        /**
         * Reproduce la siguiente canción en la playlist
         * Si el modo repeat está activado, repite la actual
         */
        // Next song
        function nextSong() {
            const currentIndex = getCurrentIndex();
            const playlist = getPlaylist();
            
            if (isRepeated) {
                // Modo repeat: repite la canción actual
                window.playSongAtIndex(currentIndex);
            } else if (currentIndex < playlist.length - 1) {
                // Avanza a la siguiente canción
                window.playSongAtIndex(currentIndex + 1);
            }
        }

        /**
         * Reproduce la canción anterior o reinicia la actual
         * - Doble click rápido (<500ms): va a la canción anterior
         * - Click simple: reinicia la canción actual
         */
        // Previous song
        function prevSong() {
            const now = Date.now();
            const timeDiff = now - lastPrevPress;
            const currentIndex = getCurrentIndex();
            const currentAudio = getCurrentAudio();
            
            // Si el segundo click fue dentro de 500ms, va a la anterior
            if (timeDiff < 500 && currentIndex > 0) {
                window.playSongAtIndex(currentIndex - 1);
            } else {
                // Si no, reinicia la canción actual
                if (currentAudio) {
                    currentAudio.currentTime = 0;
                    currentAudio.play();
                    updatePlayPauseIcon();
                }
            }
            lastPrevPress = now;
        }

        // ========================================
        // EVENT LISTENERS DEL AUDIO
        // ========================================
        
        /**
         * Configura los event listeners del elemento Audio
         * @param {HTMLAudioElement} audio - Elemento audio
         * @param {Object} song - Objeto canción
         */
        // Setup audio event listeners
        function setupAudioListeners(audio, song) {
            // Event: cuando el audio está listo para reproducirse completamente
            audio.addEventListener('canplaythrough', () => {
                if (isLoading()) {
                    setIsLoading(false);
                    audio.play().catch(error => {
                        console.error('Error playing audio:', error);
                        updatePlayPauseIcon();
                    });
                }
            }, { once: true });

            // Event: cuando se cargan los metadatos (duración, etc.)
            audio.addEventListener('loadedmetadata', () => {
                durationEl.textContent = formatDuration(Math.floor(audio.duration));
                // Refresca estadísticas del panel "Now Playing"
                if (typeof window._rpRefreshNowPlayingStats === 'function') {
                    window._rpRefreshNowPlayingStats();
                }
            });

            // Event: cuando comienza la reproducción
            audio.addEventListener('play', () => {
                setIsLoading(false);
                updatePlayPauseIcon();
                updatePlayingRow();
                if (typeof window._rpRefreshNowPlayingStats === 'function') {
                    window._rpRefreshNowPlayingStats();
                }
            });

            // Event: cuando se pausa la reproducción
            audio.addEventListener('pause', () => {
                setIsLoading(false);
                updatePlayPauseIcon();
                updatePlayingRow();
                if (typeof window._rpRefreshNowPlayingStats === 'function') {
                    window._rpRefreshNowPlayingStats();
                }
            });

            // Event: actualización continua del tiempo (cada ~250ms)
            audio.addEventListener('timeupdate', () => {
                updateProgress();
                // Si el panel de letra está abierto, sincroniza la letra
                if (isLyricsPanelOpen) {
                    updateLyrics(audio.currentTime);
                }
                if (typeof window._rpRefreshNowPlayingStats === 'function') {
                    window._rpRefreshNowPlayingStats();
                }
            });

            audio.addEventListener('ended', () => {
                setIsLoading(false);
                updatePlayPauseIcon();
                updatePlayingRow();
                if (typeof window._rpRefreshNowPlayingStats === 'function') {
                    window._rpRefreshNowPlayingStats();
                }
                nextSong();
            });

            audio.addEventListener('error', (e) => {
                setIsLoading(false);
                console.error('Error de audio:', e);
                alert('Error al reproducir la canción. Intenta con otra.');
                player.classList.remove('show');
                updatePlayPauseIcon();
                updatePlayingRow();
            });
        }

        // ========================================
        // INICIALIZACIÓN DE CONTROLES
        // ========================================
        
        /**
         * Inicializa todos los controles del reproductor
         * Configura event listeners para:
         * - Botones play/pausa, siguiente, anterior
         * - Shuffle y repeat
         * - Barra de progreso (click y drag)
         * - Control de volumen (click y drag)
         * - Atajos de teclado (Espacio, flechas, M)
         */
        // Initialize controls
        function initControls() {
            // ─── Botón Play/Pausa ───
            // Play/pause button
            playPauseBtn.addEventListener('click', () => {
                const currentAudio = getCurrentAudio();
                if (!currentAudio || isLoading()) return;
                if (currentAudio.paused) {
                    currentAudio.play();
                } else {
                    currentAudio.pause();
                }
                updatePlayPauseIcon();
            });

            // ─── Botones Siguiente/Anterior ───
            // Next/prev buttons
            prevBtn.addEventListener('click', prevSong);
            nextBtn.addEventListener('click', nextSong);

            // ─── Shuffle y Repeat ───
            // Shuffle and repeat
            shuffleBtn.addEventListener('click', () => {
                isShuffled = !isShuffled;
                shuffleBtn.classList.toggle('active', isShuffled);
            });

            repeatBtn.addEventListener('click', () => {
                isRepeated = !isRepeated;
                repeatBtn.classList.toggle('active', isRepeated);
            });

            // ─── Barra de Progreso (Drag & Click) ───
            // Progress bar
            progressContainer.addEventListener('mousedown', (e) => {
                const currentAudio = getCurrentAudio();
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
                const currentAudio = getCurrentAudio();
                if (!currentAudio) return;
                const rect = progressContainer.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
                isSeeking = true;
                currentAudio.currentTime = percentage * currentAudio.duration;
                setTimeout(() => { isSeeking = false; }, 100);
            });

            progressContainer.addEventListener('click', (e) => {
                const currentAudio = getCurrentAudio();
                if (!currentAudio) return;
                const rect = progressContainer.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const percentage = Math.max(0, Math.min(1, mouseX / rect.width));
                currentAudio.currentTime = percentage * currentAudio.duration;
                progressFill.style.width = `${percentage * 100}%`;
                currentTimeEl.textContent = formatDuration(Math.floor(percentage * currentAudio.duration));
            });

            progressContainer.addEventListener('mousemove', (e) => {
                const currentAudio = getCurrentAudio();
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

            // Volume control
            volumeFill.style.width = `${currentVolume * 100}%`;
            if (volumeThumb) volumeThumb.style.left = `${currentVolume * 100}%`;

            volumeBtn.addEventListener('click', () => {
                const currentAudio = getCurrentAudio();
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
                const currentAudio = getCurrentAudio();
                if (!currentAudio) return;
                updateVolumePosition(e);
            });

            volumeBar.addEventListener('mousedown', (e) => {
                const currentAudio = getCurrentAudio();
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

            updateVolumeIcon(false);
        }

        return {
            initControls,
            updatePlayPauseIcon,
            updateProgress,
            setupAudioListeners,
            nextSong,
            prevSong,
            setLyricsPanelOpen: (v) => { isLyricsPanelOpen = v; },
            getIsRepeated: () => isRepeated,
            getIsShuffled: () => isShuffled,
        };
    }

    global.EsplotifyPlayerControls = { createPlayerControlsModule };
})(window);
