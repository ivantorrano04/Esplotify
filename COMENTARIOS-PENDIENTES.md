# 📝 Guía de Comentarios Aplicados - ESTADO ACTUALIZADO

## ✅ Archivos Ya Comentados en Español (8/15 completados - 53%)

### 1. web/js/utils.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Todas las funciones documentadas con JSDoc
- ✅ 6 funciones: readJsonResponse, normalizeSongTitle, dedupeSongsByTitle, isTooLong, titleAlreadySeen, formatDuration

### 2. web/js/likes.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Todas las funciones documentadas: isLiked, updateLikeButton, toggleLike, toggleLikeSong
- ✅ Explicación del sistema de sincronización con backend y localStorage

### 3. web/js/queue.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Todas las funciones documentadas: addSongToQueueUnique, setQueueAndPlayFromSongs
- ✅ Explicación del manejo de duplicados

### 4. web/js/search.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción detallada de características
- ✅ Todas las funciones documentadas (8 funciones)
- ✅ Explicación de cache, lock de 300ms, filtrado local
- ✅ Documentación del sistema de optimización

### 5. web/js/auth.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Todas las funciones documentadas: isLoggedIn, checkAuthStatus, initAuthUI, closeProfileMenu, clearUserLocalStorage, logout, handleProfileClick, bindProfileMenuActions, boot
- ✅ Explicación del sistema de detección de cambio de usuario
- ✅ Comentarios en event listeners del menú de perfil

### 6. web/js/storage.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Todas las funciones documentadas: saveLikedSongs, getLikedSongsPlaylist, saveLikedSongsPlaylist, saveMadeForYouPlaylists, loadMadeForYouPlaylists
- ✅ Explicación de normalización de formato de canciones

### 7. web/js/api.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción de endpoints
- ✅ Todas las funciones documentadas: authHeaders, fetchLikedSongs, saveLikedSong, fetchRecentlyPlayed, saveRecentlyPlayed
- ✅ Explicación del sistema de autenticación Bearer token

### 8. web/js/player-controls.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Todas las funciones documentadas:
  - updatePlayPauseIcon: Actualiza icono play/pausa
  - updateProgress: Actualiza barra de progreso
  - updateSeekPosition: Manejo de drag en progreso
  - updateVolumePosition: Control de volumen
  - updateVolumeIcon: Icono de volumen dinámico
  - nextSong: Siguiente canción con repeat
  - prevSong: Anterior o reiniciar con doble-click
  - setupAudioListeners: Event listeners del audio
  - initControls: Inicialización completa de todos los controles
- ✅ Comentarios en event listeners (play, pause, timeupdate, etc.)
- ✅ Explicación de shuffle, repeat, drag & drop
- ✅ Documentación de atajos de teclado

### 9. web/script.js ✅ SECCIONES CRÍTICAS COMPLETAS
- ✅ Encabezado del archivo con descripción del orquestador
- ✅ Variables globales comentadas
- ✅ Importación de utilidades comentada
- ✅ Elementos del DOM comentados
- ✅ Inicialización de módulos comentada
- ✅ **playSongAtIndex: COMPLETAMENTE DOCUMENTADA** (función de reproducción principal)
- ✅ **autoFillRelatedQueue: COMPLETAMENTE DOCUMENTADA** (cola automática inteligente)

---

## 📋 Módulos Pendientes de Comentar (6/15 restantes - 40%)

### web/js/playlists.js (478 líneas) - PENDIENTE
**Prioridad: Media**
- Crear, editar, eliminar playlists
- Añadir/quitar canciones
- Vista de biblioteca con filtrado
- Modal de crear playlist
- Gestión de covers

### web/js/ui.js (285 líneas) - PENDIENTE
**Prioridad: Media**
- Menú contextual de canciones
- Toast notifications
- Prefetch de canciones
- Botones de acción

### web/js/views.js (173 líneas) - PENDIENTE
**Prioridad: Alta**
- Carga de datos del usuario
- Navegación entre vistas
- Vista de artista
- Vista de álbum

### web/js/results.js (231 líneas) - PENDIENTE
**Prioridad: Media**
- Renderizado de resultados
- Categorización de búsqueda

### web/js/right-panel.js (607 líneas) - PENDIENTE
**Prioridad: Alta**
- Panel derecho con 3 pestañas
- Cola con drag & drop
- Letra sincronizada

### web/js/home.js (1056 líneas) - PENDIENTE
**Prioridad: Alta**
- Vista home completa
- Playlists automáticas
- Saludo dinámico
- Grid de géneros

---

## 📊 Resumen del Progreso

### ✅ Completado: 8/15 archivos (53%)
**Líneas comentadas: ~1,450 líneas**
- utils.js (81 líneas)
- likes.js (104 líneas)
- queue.js (103 líneas)
- search.js (183 líneas)
- auth.js (71 líneas)
- storage.js (92 líneas)
- api.js (88 líneas)
- player-controls.js (362 líneas)
- script.js secciones críticas (~400 líneas)

### ❌ Pendiente: 6/15 archivos (40%)
**Líneas restantes: ~2,830 líneas**
- playlists.js (478 líneas)
- ui.js (285 líneas)
- views.js (173 líneas)
- results.js (231 líneas)
- right-panel.js (607 líneas)
- home.js (1056 líneas)

### 📈 Estadísticas Generales
- **Progreso total:** ~34% del código JavaScript total
- **Archivos completados:** 8/15 (53%)
- **Archivos pendientes:** 6/15 (40%)
- **Script principal:** Secciones críticas completas (playSongAtIndex, autoFillRelatedQueue)

---

## 🎯 Siguiente Paso Recomendado

Continuar con los módulos de UI y vistas más importantes:

1. **right-panel.js** (607 líneas) ⭐ PRIORIDAD ALTA - Panel derecho con cola y letra
2. **home.js** (1056 líneas) ⭐ PRIORIDAD ALTA - Vista principal
3. **views.js** (173 líneas) ⭐ PRIORIDAD ALTA - Navegación entre vistas
4. **results.js** (231 líneas) - Resultados de búsqueda
5. **ui.js** (285 líneas) - Componentes UI
6. **playlists.js** (478 líneas) - Gestión de playlists

---

## 📌 Resumen de Estilo de Comentarios

### Estructura Establecida
```javascript
/**
 * ========================================
 * MÓDULO DE [NOMBRE] - [Subtítulo]
 * ========================================
 * Propósito: [Descripción breve]
 * 
 * Funcionalidades:
 * - [lista de funcionalidades]
 * 
 * Exports:
 * - [función]: [descripción]
 */

/**
 * [Descripción de la función]
 * [Detalles adicionales si son complejos]
 * @param {Type} paramName - Descripción
 * @returns {Type} Descripción
 */
function nombreFuncion() {
    // Comentarios inline para lógica compleja
}
```

### Convenciones Aplicadas
- ✅ **Comentarios en español** en todo el código
- ✅ **JSDoc parcial** para parámetros y retornos
- ✅ **Comentarios inline** para lógica compleja
- ✅ **Encabezados visuales** con líneas de separación (═══)
- ✅ **Secciones organizadas** con separadores (───)
- ✅ **Explicaciones contextuales** para código no obvio
- ✅ **API pública comentada** en los exports

---

**Última actualización:** 8/15 archivos completados.
Archivos completados: utils.js, likes.js, queue.js, search.js, auth.js, storage.js, api.js, player-controls.js.
Script.js con secciones críticas completas (playSongAtIndex, autoFillRelatedQueue).

**Progreso: 53% de archivos | ~34% del código total**

### 1. web/js/utils.js ✅ COMPLETO
- ✅ Comentarios JSDoc completos en español
- ✅ Descripción del propósito del módulo
- ✅ Todas las funciones documentadas:
  - readJsonResponse: Parse seguro de respuestas JSON
  - normalizeSongTitle: Normaliza títulos para comparación
  - dedupeSongsByTitle: Elimina canciones duplicadas
  - isTooLong: Filtra canciones muy largas
  - titleAlreadySeen: Detecta títulos similares
  - formatDuration: Convierte segundos a formato "m:ss"

### 2. web/js/api.js ⚠️ PARCIALMENTE COMPLETO
- ✅ Encabezado del módulo con descripción
- ✅ authHeaders: comentado
- ✅ fetchLikedSongs: comentado
- ✅ saveLikedSong: comentado
- ✅ fetchRecentlyPlayed: comentado
- ✅ saveRecentlyPlayed: comentado
- ⚠️ Faltan algunas funciones por comentar al final del archivo

### 3. web/js/storage.js ⚠️ PARCIALMENTE COMPLETO
- ✅ Encabezado del módulo con descripción completa
- ✅ Comentarios en claves de localStorage
- ✅ saveLikedSongs: comentado
- ✅ getLikedSongsPlaylist: comentado
- ✅ saveLikedSongsPlaylist: comentado
- ✅ saveMadeForYouPlaylists: comentado
- ✅ loadMadeForYouPlaylists: comentado con explicación de normalización

### 4. web/js/auth.js ⚠️ PARCIALMENTE COMPLETO
- ✅ Encabezado del módulo con descripción
- ✅ isLoggedIn: comentado
- ✅ checkAuthStatus: comentado con detalles
- ✅ closeProfileMenu: comentado
- ✅ clearUserLocalStorage: comentado
- ✅ logout: comentado
- ✅ handleProfileClick: comentado (parcial, falta el resto de la función)
- ⚠️ Faltan funciones boot() y otras al final

### 5. web/js/likes.js ✅ COMPLETO
- ✅ Encabezado del módulo completo
- ✅ Todas las funciones documentadas:
  - isLiked: Verifica si canción está en favoritos
  - updateLikeButton: Actualiza botón de like del reproductor
  - toggleLike: Añade/quita de favoritos con sincronización
  - toggleLikeSong: Toggle con actualización de playlist

### 6. web/js/queue.js ✅ COMPLETO
- ✅ Encabezado del módulo completo
- ✅ Todas las funciones documentadas:
  - addSongToQueueUnique: Añade canción sin duplicar
  - setQueueAndPlayFromSongs: Establece cola y reproduce

### 7. web/js/search.js ✅ COMPLETO
- ✅ Encabezado del módulo con descripción detallada de características
- ✅ Todas las funciones documentadas:
  - searchCacheKey: Genera clave normalizada para cache
  - getFreshClientSearch: Obtiene del cache si es fresco
  - setClientSearch: Guarda en cache con límite de 60 entradas
  - hasAnySearchResults: Verifica si hay resultados
  - filterCategorizedSearch: Filtrado local rápido
  - cancelInFlightSearch: Cancela búsqueda en progreso
  - applyPendingSearchRenderIfNeeded: Aplica renderizado pendiente post-lock
  - attachResultInteractionLocks: Configura lock de 300ms
  - searchSongs: Función principal de búsqueda con todas las optimizaciones

### 8. web/script.js ✅ SECCIONES CRÍTICAS COMPLETAS
- ✅ Encabezado del archivo con descripción completa del orquestador
- ✅ Sección de variables globales comentada
- ✅ Sección de importación de utilidades comentada
- ✅ Sección de elementos del DOM comentada
- ✅ Inicialización del módulo de cola comentada
- ✅ Parámetros de URL y utilidades comentadas
- ✅ Inicialización de módulos API y Storage comentada
- ✅ **playSongAtIndex: COMPLETAMENTE DOCUMENTADA** (función más importante)
  - Descripción detallada del proceso completo (8 pasos)
  - Comentarios en cada sección del código
  - Event listeners explicados
- ✅ **autoFillRelatedQueue: COMPLETAMENTE DOCUMENTADA**
  - Descripción completa de la estrategia (7 pasos)
  - Detección de género comentada
  - Filtrado de covers explicado
  - Búsquedas paralelas documentadas
  - Manejo de duplicados explicado

---

## 📋 Módulos Pendientes de Comentar (7/15 restantes)

### web/js/playlists.js (478 líneas) - PENDIENTE
**Funcionalidades principales:**
- Crear, editar, eliminar playlists
- Añadir/quitar canciones
- Vista de biblioteca con filtrado
- Modal de crear playlist
- Gestión de covers de playlists

**Funciones clave a comentar:**
- openCreatePlaylistModal()
- createPlaylist(name, description)
- loadUserPlaylists()
- addSongToPlaylist(playlistId, song)
- removeSongFromPlaylist(playlistId, songId)
- deletePlaylist(playlistId)
- showLibraryView()
- getPlaylistCover(playlist)

### web/js/ui.js (285 líneas) - PENDIENTE
**Funcionalidades principales:**
- Menú contextual de canciones (3 puntos)
- Toast notifications
- Prefetch de canciones
- Botones de acción de canciones

**Funciones clave a comentar:**
- buildSongActions(song) - Menú de 3 puntos
- showToast(message) - Notificaciones
- prefetchSongs(songs) - Pre-carga de audio
- showSongContextMenu(song, trigger) - Menú contextual
- setupGlobalBindings() - Event listeners globales

### web/js/views.js (173 líneas) - PENDIENTE
**Funcionalidades principales:**
- Carga de datos del usuario
- Navegación entre vistas
- Vista de artista
- Vista de álbum

**Funciones clave a comentar:**
- loadUserData() - Carga inicial
- loadArtistPage(artistName) - Página de artista
- openAlbumView(albumTitle) - Vista de álbum
- openLikedSongsView() - Vista de favoritos
- showSearchView() - Muestra búsqueda
- showHomeView() - Muestra home

### web/js/results.js (231 líneas) - PENDIENTE
**Funcionalidades principales:**
- Renderizado de resultados de búsqueda
- Categorización (canciones, artistas, álbumes)
- Event listeners de resultados

**Funciones clave a comentar:**
- displayResults(categorizedSongs) - Función principal
- renderSongResults(songs) - Renderiza canciones
- renderArtistResults(artists) - Renderiza artistas
- renderAlbumResults(albums) - Renderiza álbumes

### web/js/right-panel.js (607 líneas) - PENDIENTE
**Funcionalidades principales:**
- Panel derecho con 3 pestañas
- Now Playing con estadísticas
- Cola con drag & drop
- Letra sincronizada con auto-scroll

**Funciones clave a comentar:**
- initRightPanel() - Inicialización
- renderNowPlaying() - Pestaña Now Playing
- renderQueue() - Cola con drag & drop
- loadAndDisplayLyrics(song) - Carga letra
- updateLyrics(currentTime) - Sincronización de letra
- highlightCurrentLyric() - Resalta línea actual

### web/js/player-controls.js (362 líneas) - PENDIENTE
**Funcionalidades principales:**
- Controles del reproductor
- Barra de progreso con drag
- Control de volumen con drag
- Atajos de teclado

**Funciones clave a comentar:**
- initControls() - Inicialización
- updatePlayPauseIcon() - Actualiza icono
- updateProgress() - Actualiza barra de progreso
- setupProgressBarDrag() - Drag en progreso
- setupVolumeControl() - Control de volumen
- nextSong() - Siguiente canción
- prevSong() - Canción anterior
- setupKeyboardShortcuts() - Atajos de teclado

### web/js/home.js (1056 líneas) - PENDIENTE
**Funcionalidades principales:**
- Vista home completa
- Playlists automáticas (3 tipos)
- Saludo dinámico
- Grid de géneros

**Funciones clave a comentar:**
- generateRecommendations(recentlyPlayed) - Genera 3 playlists
- populateHomeCards() - Renderiza toda la vista
- refreshDiscoveryNow() - Regenera Descubrimiento Semanal
- openPlaylistFromHome(pl) - Abre playlist desde home
- loadNovedades() - Carga nuevos lanzamientos
- loadTendencias() - Carga tendencias
- buildHomeDiscoverGrid() - Grid de descubrimiento
- buildSpCard() - Tarjeta de canción
- buildAlbumSpCard() - Tarjeta de álbum

---

## 📊 Resumen del Progreso

### ✅ Completado: 5/15 archivos (33%)
- utils.js (81 líneas)
- likes.js (104 líneas)
- queue.js (103 líneas)
- search.js (183 líneas)
- **script.js secciones críticas** (playSongAtIndex, autoFillRelatedQueue)

### ⚠️ Parcialmente completado: 3/15 archivos (20%)
- api.js (88 líneas) - ~80% completo
- storage.js (92 líneas) - ~90% completo
- auth.js (71 líneas) - ~70% completo

### ❌ Pendiente: 7/15 archivos (47%)
- playlists.js (478 líneas)
- ui.js (285 líneas)
- views.js (173 líneas)
- results.js (231 líneas)
- right-panel.js (607 líneas)
- player-controls.js (362 líneas)
- home.js (1056 líneas)

### 📈 Estadísticas
- **Líneas comentadas:** ~650 líneas
- **Líneas restantes:** ~3,200 líneas
- **Progreso total:** ~17% del código JavaScript total

---

## 🎯 Siguiente Paso Recomendado

Continuar con los módulos de UI y vistas que son críticos para la experiencia del usuario:

1. **player-controls.js** (362 líneas) - Controles del reproductor
2. **right-panel.js** (607 líneas) - Panel derecho
3. **home.js** (1056 líneas) - Vista home
4. **ui.js** (285 líneas) - Componentes UI
5. **views.js** (173 líneas) - Navegación
6. **results.js** (231 líneas) - Resultados de búsqueda
7. **playlists.js** (478 líneas) - Gestión de playlists

---

## 📌 Notas Importantes

### Estilo de Comentarios Establecido
```javascript
/**
 * ========================================
 * MÓDULO DE [NOMBRE] - [Subtítulo]
 * ========================================
 * Propósito: [Descripción breve]
 * 
 * Funcionalidades:
 * - [lista de funcionalidades]
 */

/**
 * [Descripción de la función]
 * [Detalles adicionales si son complejos]
 * @param {Type} paramName - Descripción
 * @returns {Type} Descripción
 */
function nombreFuncion() { }
```

### Convenciones Usadas
- **Comentarios en español** en todo el código
- **JSDoc parcial** para parámetros y retornos
- **Comentarios inline** para lógica compleja
- **Encabezados visuales** con líneas de separación
- **Explicaciones contextuales** para código no obvio

---

**Última actualización:** Archivos utils.js, likes.js, queue.js, search.js completamente comentados.
Archivos api.js, storage.js, auth.js parcialmente comentados.
Archivo script.js con secciones críticas (playSongAtIndex, autoFillRelatedQueue) completamente documentadas.

### Para cada módulo agregar al inicio:
```javascript
/**
 * ========================================
 * MÓDULO DE [NOMBRE] - Esplotify
 * ========================================
 * Propósito: [Descripción breve]
 * 
 * Dependencias:
 * - [listar dependencias]
 * 
 * Exports:
 * - [función1]: [descripción]
 * - [función2]: [descripción]
 */
```

### Para cada función:
```javascript
/**
 * [Descripción de qué hace la función]
 * @param {Type} paramName - Descripción del parámetro
 * @returns {Type} Descripción del retorno
 */
```

## 📦 Módulos Pendientes de Comentar

### web/js/api.js
**Comentarios a agregar:**
```javascript
/**
 * MÓDULO DE API - Llamadas HTTP al Backend
 * 
 * Exports:
 * - saveLikedSong: Guarda canción favorita (POST /liked-songs)
 * - fetchLikedSongs: Obtiene favoritos (GET /liked-songs)
 * - saveLikedSongs: Guardado masivo (PUT /liked-songs/bulk)
 * - saveAutoGeneratedPlaylist: Guarda playlist automática (POST /auto-playlists)
 * - fetchAutoGeneratedPlaylists: Obtiene playlists automáticas
 * - saveRecentlyPlayed: Guarda reproducidas (POST /recently-played/bulk)
 * - fetchRecentlyPlayed: Obtiene reproducidas
 */
```

### web/js/storage.js
**Comentarios a agregar:**
```javascript
/**
 * MÓDULO DE ALMACENAMIENTO - LocalStorage
 * 
 * Gestiona la persistencia local de:
 * - Playlist de canciones favoritas
 * - Playlists auto-generadas (Mix Diario, Descubrimiento Semanal, etc.)
 * 
 * Constantes:
 * - LIKED_SONGS_KEY: 'likedSongsPlaylist'
 * - MADE_FOR_YOU_KEY: 'madeForYouPlaylists'
 * - RECIENTES_PLAYLIST_ID: 'recently-played-auto'
 */
```

### web/js/auth.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE AUTENTICACIÓN
 * 
 * Gestiona:
 * - Verificación de tokens JWT
 * - Redirección a login si no autenticado
 * - Inicialización de sesión
 */

/**
 * Verifica si el usuario está logueado
 * Revisa la existencia y validez del token JWT en localStorage
 * @returns {boolean} True si hay token válido
 */
function isLoggedIn() { }

/**
 * Inicializa la autenticación de la aplicación
 * Si no hay token válido, redirige a login.html
 */
function boot() { }
```

### web/js/likes.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE LIKES - Sistema de "Me Gusta"
 * 
 * Gestiona:
 * - Toggle de favoritos (añadir/quitar)
 * - Sincronización con backend
 * - Actualización de UI
 */

/**
 * Añade o quita una canción de favoritos
 * @param {Object} song - Objeto canción
 */
function toggleLike(song) { }

/**
 * Verifica si una canción está en favoritos
 * @param {Object} song - Objeto canción
 * @returns {boolean} True si está en favoritos
 */
function isLiked(song) { }
```

### web/js/playlists.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE PLAYLISTS - Gestión Completa
 * 
 * Funcionalidades:
 * - Crear, editar, eliminar playlists
 * - Añadir/quitar canciones
 * - Vista de biblioteca
 * - Filtrado y búsqueda
 * - Modal de crear playlist
 */

/**
 * Abre el modal para crear nueva playlist
 */
function openCreatePlaylistModal() { }

/**
 * Crea una nueva playlist
 * @param {string} name - Nombre de la playlist
 * @param {string} description - Descripción (opcional)
 */
function createPlaylist(name, description) { }
```

### web/js/search.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE BÚSQUEDA
 * 
 * Características:
 * - Cache cliente con TTL de 60 segundos
 * - Debounce para reducir peticiones
 * - Lock de selección (300ms) para prevenir clicks duplicados
 */

/**
 * Busca canciones con cache y debounce
 * @param {string} query - Término de búsqueda
 * @returns {Promise} Resultados categorizados
 */
function searchSongs(query) { }
```

### web/js/queue.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE COLA DE REPRODUCCIÓN
 * 
 * Gestiona:
 * - Cola actual de canciones
 * - Añadir canciones sin duplicar
 * - Establecer cola y reproducir
 */

/**
 * Añade una canción a la cola sin duplicar
 * @param {Object} song - Canción a añadir
 */
function addSongToQueueUnique(song) { }

/**
 * Establece una nueva cola y reproduce la canción seleccionada
 * @param {Array} songs - Array de canciones
 * @param {Object} clickedSong - Canción a reproducir
 */
function setQueueAndPlayFromSongs(songs, clickedSong) { }
```

### web/js/ui.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE UI - Componentes de Interfaz
 * 
 * Componentes:
 * - Menú contextual de canciones (3 puntos)
 * - Toast notifications
 * - Prefetch de canciones
 * - Cover de playlists
 * - Bindings de eventos generales
 */

/**
 * Construye el menú de acciones de una canción
 * @param {Object} song - Objeto canción
 * @returns {HTMLElement} Elemento con botón de 3 puntos
 */
function buildSongActions(song) { }

/**
 * Muestra un mensaje toast
 * @param {string} message - Mensaje a mostrar
 */
function showToast(message) { }

/**
 * Pre-carga canciones en segundo plano para reproducción más rápida
 * @param {Array} songs - Array de canciones
 */
function prefetchSongs(songs) { }
```

### web/js/views.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE VISTAS - Navegación
 * 
 * Gestiona:
 * - Carga inicial de datos del usuario
 * - Navegación entre vistas (home, búsqueda, biblioteca)
 * - Vista de artista
 * - Vista de álbum
 */

/**
 * Carga los datos iniciales del usuario al iniciar sesión
 * - Canciones favoritas
 * - Playlists
 * - Historial de reproducción
 */
async function loadUserData() { }

/**
 * Carga y muestra la página de un artista
 * @param {string} artistName - Nombre del artista
 */
function loadArtistPage(artistName) { }
```

### web/js/results.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE RESULTADOS - Renderizado de Búsqueda
 * 
 * Renderiza resultados en categorías:
 * - Canciones (hasta 8)
 * - Artistas (hasta 6)
 * - Álbumes (hasta 6)
 * - Playlists (si hay)
 */

/**
 * Muestra los resultados de búsqueda categorizados
 * @param {Object} categorizedSongs - Objeto con categorías
 */
function displayResults(categorizedSongs) { }
```

### web/js/right-panel.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DEL PANEL DERECHO
 * 
 * Pestañas:
 * - Now Playing: Canción actual con estadísticas
 * - Cola: Lista de reproducción con drag & drop
 * - Letra: Letra sincronizada con auto-scroll
 */

/**
 * Inicializa el panel derecho y sus pestañas
 */
function initRightPanel() { }

/**
 * Renderiza la cola de reproducción con drag & drop
 */
function renderQueue() { }

/**
 * Carga y muestra la letra de una canción
 * @param {Object} song - Canción actual
 */
async function loadAndDisplayLyrics(song) { }

/**
 * Actualiza la posición de la letra según el tiempo
 * @param {number} currentTime - Tiempo actual en segundos
 */
function updateLyrics(currentTime) { }
```

### web/js/player-controls.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE CONTROLES DEL REPRODUCTOR
 * 
 * Controles:
 * - Play/Pausa
 * - Siguiente/Anterior
 * - Shuffle (aleatorio)
 * - Repeat (repetir)
 * - Barra de progreso con drag
 * - Control de volumen con drag
 * - Atajos de teclado
 */

/**
 * Inicializa todos los controles del reproductor
 */
function initControls() { }

/**
 * Actualiza el icono de play/pausa según el estado
 */
function updatePlayPauseIcon() { }

/**
 * Reproduce la siguiente canción
 * Respeta el modo shuffle y repeat
 */
function nextSong() { }

/**
 * Reproduce la canción anterior
 */
function prevSong() { }
```

### web/js/home.js
**Comentarios clave:**
```javascript
/**
 * MÓDULO DE HOME - Vista Principal
 * 
 * Secciones:
 * - Saludo dinámico según hora del día
 * - Grid 3x2 de canciones recientes
 * - Playlists automáticas:
 *   · Mix Diario (30 canciones aleatorias de artistas recientes)
 *   · Descubrimiento Semanal (50 canciones nuevas de artistas conocidos)
 *   · Radar de Novedades (40 canciones de artistas no escuchados)
 * - Novedades y Tendencias
 * - Grid de géneros musicales
 */

/**
 * Genera las playlists automáticas basadas en historial
 * @param {Array} recentlyPlayed - Canciones reproducidas recientemente
 * @returns {Object} Objeto con las 3 playlists generadas
 */
function generateRecommendations(recentlyPlayed) { }

/**
 * Renderiza toda la vista home con todas sus secciones
 */
function populateHomeCards() { }

/**
 * Regenera la playlist Descubrimiento Semanal inmediatamente
 */
async function refreshDiscoveryNow() { }
```

## 🔧 script.js - Orquestador Principal

**Secciones principales a comentar:**

```javascript
// ========================================
// VARIABLES GLOBALES Y ESTADO
// ========================================
// Estado del reproductor
let currentAudio = null;          // Elemento Audio actual
let playlist = [];                // Cola de reproducción
let currentIndex = -1;            // Índice de canción actual en la cola
let currentSong = null;           // Objeto de la canción actual
let isLoading = false;            // Estado de carga
let currentVolume = 0.5;          // Volumen actual (0.0 - 1.0)

// ========================================
// ELEMENTOS DEL DOM
// ========================================
// Elementos de búsqueda
const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const loadingDiv = document.getElementById('loading');
const errorDiv = document.getElementById('error');

// Elementos del reproductor
const volumeBtn = document.getElementById('volBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
// ... etc

// ========================================
// INICIALIZACIÓN DE MÓDULOS
// ========================================
// Los módulos se inicializan en orden de dependencias

// ========================================
// FUNCIÓN PRINCIPAL DE REPRODUCCIÓN
// ========================================
/**
 * Reproduce una canción en el índice especificado de la playlist
 * - Pausa la canción actual si existe
 * - Crea un nuevo elemento Audio
 * - Configura todos los event listeners
 * - Actualiza la UI (thumbnail, título, artista)
 * - Inicia la reproducción
 * 
 * @param {number} index - Índice de la canción en la playlist
 */
window.playSongAtIndex = async function playSongAtIndex(index) {
    // Validaciones
    if (index < 0 || index >= playlist.length || isLoading) return;
    
    // Actualiza índice actual
    currentIndex = index;
    
    // ... resto del código
}

// ========================================
// AUTO-QUEUE (COLA AUTOMÁTICA)
// ========================================
/**
 * Genera automáticamente una cola de canciones relacionadas
 * Busca canciones del mismo artista que no estén en la cola actual
 */
async function autoFillRelatedQueue(song) { }

// ========================================
// MODALES Y VENTANAS
// ========================================
/**
 * Abre el modal para añadir canción a playlist
 */
async function openAddToPlaylistModal(trigger) { }

// ========================================
// NAVEGACIÓN ENTRE VISTAS
// ========================================
/**
 * Muestra la vista de biblioteca
 */
function showLibraryView() { }

/**
 * Muestra la vista home
 */
function showHomeView() { }

/**
 * Muestra la vista de búsqueda
 */
function showSearchView() { }

// ========================================
// MANEJO DE PLAYLISTS
// ========================================
/**
 * Muestra una playlist en la vista de playlist
 */
function displayPlaylistView(playlistData) { }

// ========================================
// EVENT LISTENERS GLOBALES
// ========================================
// Configurados al final del archivo una vez todo está inicializado
```

## 📌 Notas Importantes

### Patrón de Factory Functions
Todos los módulos usan este patrón:
```javascript
function createModuloNombre(config) {
    // Destructuring de configuración
    const { deps, state, constants } = config;
    
    // Funciones privadas (no exportadas)
    function funcionPrivada() { }
    
    // Funciones públicas (exportadas)
    function funcionPublica() { }
    
    // Retorna API pública del módulo
    return {
        funcionPublica,
        // ...más funciones
    };
}
```

### Inyección de Dependencias
Los módulos NO importan otros módulos directamente. Las dependencias se inyectan:
```javascript
const modulo = createModulo({
    deps: {
        funcionExterna,    // Función de otro módulo
        elemento,          // Elemento del DOM
        fetchImpl: fetch,  // API nativa
    }
});
```

### Uso de Window para Referencias Futuras
Cuando una función se define más tarde pero se necesita antes:
```javascript
// Uso temprano (línea 100)
playSongAtIndex: (index) => window.playSongAtIndex(index)

// Definición tardía (línea 840)
window.playSongAtIndex = async function playSongAtIndex(index) { }
```

## ✅ Checklist de Completado

- [x] Crear GUIA-ARQUITECTURA.md con documentación completa
- [x] Comentar web/js/utils.js
- [ ] Comentar web/js/api.js
- [ ] Comentar web/js/storage.js
- [ ] Comentar web/js/auth.js
- [ ] Comentar web/js/likes.js
- [ ] Comentar web/js/playlists.js
- [ ] Comentar web/js/search.js
- [ ] Comentar web/js/queue.js
- [ ] Comentar web/js/ui.js
- [ ] Comentar web/js/views.js
- [ ] Comentar web/js/results.js
- [ ] Comentar web/js/right-panel.js
- [ ] Comentar web/js/player-controls.js
- [ ] Comentar web/js/home.js
- [ ] Comentar web/script.js (orquestador principal)

---

**Nota:** Este archivo contiene plantillas y guías para agregar comentarios a los archivos restantes. 
Se recomienda seguir el mismo estilo de comentarios usado en utils.js para mantener consistencia.
