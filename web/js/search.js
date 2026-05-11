/**
 * ========================================
 * MÓDULO DE BÚSQUEDA - Sistema Inteligente
 * ========================================
 * Propósito: Gestiona búsquedas con optimizaciones avanzadas
 * 
 * Características:
 * - Cache cliente con TTL de 60 segundos
 * - Cancelación de búsquedas anteriores en progreso
 * - Lock de 300ms al hacer click para evitar cambios involuntarios
 * - Filtrado local rápido cuando se extiende una búsqueda
 * - Manejo de duplicados y normalización de resultados
 */
(function () {
    function createSearchModule(config) {
        const {
            state,
            constants,
            deps,
        } = config;

        const {
            searchInput,
            resultsDiv,
            loadingDiv,
            errorDiv,
            displayResults,
            fetchImpl,
        } = deps;

        const {
            SEARCH_CLICK_LOCK_MS,           // 300ms - tiempo de lock al hacer click
            SEARCH_CLIENT_CACHE_TTL_MS,     // 60000ms - duración de cache cliente
        } = constants;

        /**
         * Genera una clave normalizada para el cache
         * @param {string} query - Query de búsqueda
         * @returns {string} Clave normalizada (lowercase, sin espacios extra)
         */
        function searchCacheKey(query) {
            return String(query || '').trim().toLowerCase();
        }

        /**
         * Obtiene resultados del cache si son frescos (< 60s)
         * @param {string} query - Query de búsqueda
         * @returns {Object|null} Datos cacheados o null si expiró
         */
        function getFreshClientSearch(query) {
            const finalKey = searchCacheKey(query);
            const hit = state.clientCache.get(finalKey);
            if (!hit) return null;
            
            // Verifica si el cache expiró
            if (Date.now() - hit.time > SEARCH_CLIENT_CACHE_TTL_MS) {
                state.clientCache.delete(finalKey);
                return null;
            }
            return hit.data;
        }

        /**
         * Guarda resultados en el cache cliente
         * Limita el cache a 60 entradas máximo
         * @param {string} query - Query de búsqueda
         * @param {Object} data - Datos a cachear
         */
        function setClientSearch(query, data) {
            const key = searchCacheKey(query);
            state.clientCache.set(key, { time: Date.now(), data });
            
            // Limpia el cache más antiguo si supera 60 entradas
            if (state.clientCache.size > 60) {
                const oldestKey = state.clientCache.keys().next().value;
                if (oldestKey) state.clientCache.delete(oldestKey);
            }
        }

        /**
         * Verifica si hay algún resultado en las categorías
         * @param {Object} categorizedSongs - Objeto con categorías de resultados
         * @returns {boolean} True si hay al menos un resultado
         */
        function hasAnySearchResults(categorizedSongs) {
            if (!categorizedSongs) return false;
            return Object.values(categorizedSongs).some(v => Array.isArray(v) && v.length > 0);
        }

        /**
         * Filtra resultados localmente sin hacer petición al servidor
         * Útil cuando el usuario extiende una búsqueda anterior (ej: "rock" → "rock and roll")
         * @param {Object} categorizedSongs - Resultados previos
         * @param {string} query - Nueva query
         * @returns {Object} Resultados filtrados
         */
        function filterCategorizedSearch(categorizedSongs, query) {
            const q = String(query || '').toLowerCase().trim();
            if (!q || !categorizedSongs) return categorizedSongs;

            // Filtro para canciones y podcasts
            const filterSongLike = (arr) => (arr || []).filter(s => {
                const t = String((s && s.title) || '').toLowerCase();
                const a = String((s && s.author) || '').toLowerCase();
                return t.includes(q) || a.includes(q);
            }).slice(0, 12);

            // Filtro para álbumes
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

        /**
         * Cancela la búsqueda en progreso si existe
         */
        function cancelInFlightSearch() {
            if (state.activeController) {
                state.activeController.abort();
                state.activeController = null;
            }
        }

        /**
         * Aplica el renderizado pendiente si el lock de selección ya expiró
         * El lock previene que los resultados cambien mientras el usuario hace click
         */
        function applyPendingSearchRenderIfNeeded() {
            if (!state.pendingRender) return;
            
            // Espera a que expire el lock de selección
            if (Date.now() < state.selectionLockUntil) {
                setTimeout(applyPendingSearchRenderIfNeeded, state.selectionLockUntil - Date.now() + 15);
                return;
            }

            const { seq, query, data, forceApply } = state.pendingRender;
            state.pendingRender = null;

            // Verifica que siga siendo la búsqueda más reciente
            if (seq !== state.requestSeq) return;
            if (!forceApply && searchInput && searchInput.value.trim() !== query) return;
            
            displayResults(data);
        }

        /**
         * Configura los event listeners para el lock de selección
         * Cuando el usuario hace click, se bloquean cambios de resultados por 300ms
         */
        function attachResultInteractionLocks() {
            if (!resultsDiv) return;
            
            // Al hacer click, activa el lock
            resultsDiv.addEventListener('pointerdown', () => {
                state.selectionLockUntil = Date.now() + SEARCH_CLICK_LOCK_MS;
            });
            
            // Al soltar el click, aplica cambios pendientes
            document.addEventListener('pointerup', () => {
                setTimeout(applyPendingSearchRenderIfNeeded, 0);
            });
        }

        /**
         * Busca canciones con cache, debounce y lock de selección
         * @param {string} query - Término de búsqueda
         * @param {Object} options - Opciones adicionales
         * @param {boolean} options.preserveResults - Si mantener resultados previos
         * @param {boolean} options.forceApply - Si aplicar forzosamente sin validar input
         */
        async function searchSongs(query, options = {}) {
            const normalizedQuery = String(query || '').trim();
            if (!normalizedQuery) return;

            const preserveResults = options.preserveResults !== false;
            const forceApply = options.forceApply === true;

            // Incrementa secuencia para invalidar búsquedas antiguas
            const seq = ++state.requestSeq;
            cancelInFlightSearch();
            const controller = new AbortController();
            state.activeController = controller;

            // Muestra indicador de carga
            loadingDiv.style.display = 'flex';
            errorDiv.style.display = 'none';
            if (!preserveResults) resultsDiv.innerHTML = '';

            // Intenta obtener del cache cliente
            const cached = getFreshClientSearch(normalizedQuery);
            if (cached && hasAnySearchResults(cached)) {
                displayResults(cached);
                loadingDiv.style.display = 'none';
                return;
            }

            // Optimización: si la nueva búsqueda extiende la anterior, filtra localmente
            if (state.lastData && normalizedQuery.toLowerCase().startsWith(state.lastQuery.toLowerCase()) && state.lastQuery.length >= 2) {
                const quick = filterCategorizedSearch(state.lastData, normalizedQuery);
                if (hasAnySearchResults(quick)) {
                    displayResults(quick);
                }
            }

            try {
                // Petición al servidor
                const response = await fetchImpl(`/search?q=${encodeURIComponent(normalizedQuery)}`, {
                    signal: controller.signal,
                });
                const data = await response.json();
                if (data.error) {
                    throw new Error(data.error);
                }

                // Guarda en cache
                setClientSearch(normalizedQuery, data);
                state.lastQuery = normalizedQuery;
                state.lastData = data;

                // Verifica que siga siendo la búsqueda más reciente
                if (seq !== state.requestSeq) return;
                if (!forceApply && searchInput && searchInput.value.trim() !== normalizedQuery) return;

                // Si hay lock de selección activo, pospone el renderizado
                if (Date.now() < state.selectionLockUntil) {
                    state.pendingRender = { seq, query: normalizedQuery, data, forceApply };
                    return;
                }

                state.pendingRender = null;
                displayResults(data);
                
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                errorDiv.textContent = 'Error al buscar: ' + err.message;
                errorDiv.style.display = 'block';
            } finally {
                if (seq === state.requestSeq) {
                    loadingDiv.style.display = 'none';
                }
            }
        }

        return {
            cancelInFlightSearch,
            applyPendingSearchRenderIfNeeded,
            attachResultInteractionLocks,
            searchSongs,
        };
    }

    window.EsplotifySearch = {
        createSearchModule,
    };
})();
