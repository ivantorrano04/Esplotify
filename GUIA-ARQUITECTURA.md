# 📚 Guía de Arquitectura - Esplotify

## 🏗️ Estructura General del Proyecto

```
Esplotify-main/
├── bin/
│   └── servidor_esplotify.dart        # Servidor backend en Dart
├── lib/
│   ├── auth.dart                      # Lógica de autenticación backend
│   ├── database.dart                  # Gestión de base de datos SQLite
│   └── servidor_esplotify.dart        # Implementación del servidor
├── web/                               # Frontend (HTML, CSS, JS)
│   ├── index.html                     # Página principal
│   ├── login.html                     # Página de inicio de sesión
│   ├── register.html                  # Página de registro
│   ├── script.js                      # Orquestador principal (1463 líneas)
│   ├── js/                            # Módulos JavaScript (arquitectura modular)
│   │   ├── utils.js                   # Utilidades generales
│   │   ├── api.js                     # Llamadas a API
│   │   ├── storage.js                 # LocalStorage
│   │   ├── auth.js                    # Autenticación frontend
│   │   ├── likes.js                   # Sistema de "me gusta"
│   │   ├── playlists.js               # Gestión de playlists
│   │   ├── search.js                  # Búsqueda de canciones
│   │   ├── queue.js                   # Cola de reproducción
│   │   ├── ui.js                      # Componentes de interfaz
│   │   ├── views.js                   # Gestión de vistas
│   │   ├── results.js                 # Renderizado de resultados
│   │   ├── right-panel.js             # Panel derecho (cola/letra)
│   │   ├── player-controls.js         # Controles del reproductor
│   │   └── home.js                    # Vista principal/home
│   └── [archivos CSS]                 # Estilos por componente
└── data/                              # Base de datos SQLite
```

---

## 🎯 Arquitectura Frontend: Patrón Modular

### Orden de Carga de Scripts (web/index.html líneas 659-673)

```html
<!-- 1. Módulos base -->
<script src="js/utils.js"></script>
<script src="js/api.js"></script>
<script src="js/storage.js"></script>

<!-- 2. Módulos de funcionalidad -->
<script src="js/auth.js"></script>
<script src="js/likes.js"></script>
<script src="js/playlists.js"></script>
<script src="js/search.js"></script>
<script src="js/queue.js"></script>
<script src="js/ui.js"></script>
<script src="js/views.js"></script>
<script src="js/results.js"></script>

<!-- 3. Módulos de UI avanzada -->
<script src="js/right-panel.js"></script>
<script src="js/player-controls.js"></script>
<script src="js/home.js"></script>

<!-- 4. Orquestador principal -->
<script src="script.js"></script>
```

---

## 📍 Ubicación de Componentes en index.html

### 🎨 Barra Superior (Top Bar)
**Ubicación:** `index.html` líneas 97-125
- **Botón Explorar:** `#topBrowseBtn` - Alterna entre home y búsqueda
- **Barra de búsqueda:** `#searchInput` - Input principal de búsqueda
- **Botón de perfil:** `.profile-btn` - Abre menú de usuario
- **Menú de perfil:** `.profile-menu` - Contiene cuenta, soporte, configuración, logout

### 🎵 Reproductor (Player Bar)
**Ubicación:** `index.html` líneas 466-544
- **Thumbnail:** `#playerThumbnail` - Imagen de la canción actual
- **Título:** `#playerTitle` - Nombre de la canción
- **Artista:** `#playerAuthor` - Nombre del artista (clickeable)
- **Botón Me Gusta:** `#playerLikeBtn` - Toggle para like/unlike
- **Controles:**
  - Shuffle: `#shuffleBtn`
  - Anterior: `#prevBtn`
  - Play/Pausa: `#playPauseBtn`
  - Siguiente: `#nextBtn`
  - Repetir: `#repeatBtn`
- **Barra de progreso:** `#progressBar` - Con `#progressFill` y `#progressThumb`
- **Tiempo:** `#currentTime` y `#duration`
- **Volumen:** `#volBtn`, `#volumeBar` con `#volumeFill` y `#volumeThumb`

### 🏠 Vista Home
**Ubicación:** `index.html` líneas 153-245
- **Saludo:** `#greetingText` - Saludo dinámico según hora
- **Gradiente header:** `#homeHeaderGradient` - Color dinámico
- **Grid recientes:** `#recentGrid` - 6 canciones recientes
- **Secciones dinámicas:**
  - `#jumpBackSlider` - Volver a escuchar
  - `#madeForYouSlider` - Hecho para ti (Mix Diario, etc.)
  - `#topArtistsSlider` - Artistas favoritos
  - `#novedadesSlider` - Novedades
  - `#tendenciasSlider` - Tendencias
  - `#discoverGenreGrid` - Grid de géneros

### 🔍 Vista de Búsqueda
**Ubicación:** `index.html` líneas 247-258
- **Tiles de género:** `#genreTiles` > `#genreGrid` - Muestra géneros cuando búsqueda vacía
- **Indicadores:**
  - `#loading` - "Buscando..."
  - `#error` - Mensajes de error
- **Resultados:** `#results` - Contenedor dinámico de resultados

### 📚 Vista de Biblioteca
**Ubicación:** `index.html` líneas 294-329
- **Filtros:** `.library-filters` - Todo/Playlists/Artistas/Álbumes
- **Barra búsqueda:** `#librarySearchInput`
- **Grid:** `#libraryGrid` - Muestra playlists del usuario

### 🎼 Vista de Playlist
**Ubicación:** `index.html` líneas 260-292
- **Cover:** `#playlistCoverImg` - Imagen de la playlist
- **Título:** `#playlistTitle` - Nombre
- **Descripción:** `#playlistDescription`
- **Botón play:** `.play-playlist-btn` - Reproduce toda la playlist
- **Lista de canciones:** `#playlistSongsList` - Canciones con acciones

### ↗️ Panel Derecho (Right Panel)
**Ubicación:** `index.html` líneas 546-597
- **Pestañas:**
  - `#nowPlayingTab` - Canción actual con estadísticas
  - `#queueTab` - Cola de reproducción (drag & drop)
  - `#lyricsTab` - Letra sincronizada
- **Botón cerrar:** `.close-right-panel` - Cierra el panel
- **Contenedores:**
  - `#nowPlayingContent`
  - `#queueContent`
  - `#lyricsContent`

### 🎭 Sidebar Izquierda
**Ubicación:** `index.html` líneas 47-94
- **Navegación principal:**
  - `#homeNav` - Botón Inicio
  - `#searchNav` - Botón Buscar
  - `#libraryNav` - Tu biblioteca
- **Biblioteca:**
  - `#createPlaylistBtn` - Crear nueva playlist
  - `#sidebarLibSearchInput` - Buscar en biblioteca
  - `#sidebarPlaylists` - Lista de playlists del usuario

---

## 🔧 Módulos JavaScript Detallados

### 1️⃣ **web/js/utils.js** (81 líneas)
**Propósito:** Utilidades compartidas
**Exports:**
- `readJsonResponse(response)` - Parse seguro de JSON
- `normalizeSongTitle(title)` - Limpia títulos
- `formatDuration(seconds)` - Convierte segundos a "mm:ss"
- `dedupeSongsByTitle(songs)` - Elimina duplicados
- `isTooLong(duration)` - Filtra canciones muy largas (>10min)
- `titleAlreadySeen(title, seen)` - Detecta duplicados

### 2️⃣ **web/js/api.js** (88 líneas)
**Propósito:** Llamadas HTTP al backend
**Exports:**
- `saveLikedSong(token, song)` - POST /liked-songs
- `fetchLikedSongs(token)` - GET /liked-songs
- `saveLikedSongs(token, songs)` - PUT /liked-songs/bulk
- `saveAutoGeneratedPlaylist(playlist)` - POST /auto-playlists
- `fetchAutoGeneratedPlaylists(token)` - GET /auto-playlists
- `saveRecentlyPlayed(token, songs)` - POST /recently-played/bulk
- `fetchRecentlyPlayed(token)` - GET /recently-played

### 3️⃣ **web/js/storage.js** (92 líneas)
**Propósito:** Gestión de localStorage
**Exports:**
- `getLikedSongsPlaylist()` - Obtiene playlist de favoritos
- `saveLikedSongsPlaylist(playlist)` - Guarda playlist favoritos
- `loadMadeForYouPlaylists()` - Carga playlists generadas (Mix Diario, etc.)
- `saveMadeForYouPlaylists(playlists)` - Guarda playlists generadas
- **Constantes:** `LIKED_SONGS_KEY`, `MADE_FOR_YOU_KEY`, `RECIENTES_PLAYLIST_ID`

### 4️⃣ **web/js/auth.js** (71 líneas)
**Propósito:** Autenticación y sesión
**Exports:**
- `createAuthModule(config)` - Factory del módulo
  - `isLoggedIn()` - Verifica si hay token válido
  - `boot()` - Inicializa autenticación, redirige a login si no autenticado

### 5️⃣ **web/js/likes.js** (104 líneas)
**Propósito:** Sistema de "me gusta"
**Exports:**
- `createLikesModule(config)` - Factory del módulo
  - `toggleLike(song)` - Añade/quita like
  - `isLiked(song)` - Verifica si canción tiene like
  - `updateLikeButton()` - Actualiza UI del botón
  - `toggleLikeSong(song)` - Wrapper para toggle

### 6️⃣ **web/js/playlists.js** (478 líneas)
**Propósito:** Gestión completa de playlists
**Exports:**
- `createPlaylistsModule(config)` - Factory del módulo
  - `openCreatePlaylistModal()` - Abre modal crear playlist
  - `closeCreatePlaylistModal()` - Cierra modal
  - `createPlaylist(name, description)` - Crea nueva playlist
  - `loadAndDisplayPlaylist(playlistId)` - Muestra playlist específica
  - `displayPlaylists(playlists)` - Renderiza lista de playlists
  - `filterSidebarPlaylists(query)` - Filtra sidebar
  - `displayLibrary()` - Muestra vista biblioteca
  - `loadLibrary()` - Carga biblioteca del usuario
  - `deletePlaylist(playlistId)` - Elimina playlist

### 7️⃣ **web/js/search.js** (183 líneas)
**Propósito:** Búsqueda con cache y debounce
**Exports:**
- `createSearchModule(config)` - Factory del módulo
  - `searchSongs(query)` - Busca canciones (con cache cliente)
  - `attachResultInteractionLocks()` - Previene clicks duplicados
**Características:**
- Cache cliente (60s TTL)
- Debounce de búsqueda
- Lock de selección (300ms)

### 8️⃣ **web/js/queue.js** (103 líneas)
**Propósito:** Cola de reproducción
**Exports:**
- `createQueueModule(config)` - Factory del módulo
  - `addSongToQueueUnique(song)` - Añade canción sin duplicar
  - `setQueueAndPlayFromSongs(songs, clickedSong)` - Establece cola y reproduce

### 9️⃣ **web/js/ui.js** (285 líneas)
**Propósito:** Componentes de interfaz reutilizables
**Exports:**
- `createUiModule(config)` - Factory del módulo
  - `buildSongActions(song)` - Crea menú contextual de canción
  - `showSongContextMenu(e, song)` - Muestra menú contextual
  - `showToast(message)` - Notificación toast
  - `getPlaylistCover(playlist)` - Obtiene cover de playlist
  - `prefetchSongs(songs)` - Pre-carga canciones en segundo plano
  - `initUiBindings()` - Inicializa eventos UI generales

### 🔟 **web/js/views.js** (173 líneas)
**Propósito:** Gestión de navegación entre vistas
**Exports:**
- `createViewsModule(config)` - Factory del módulo
  - `loadUserData()` - Carga datos iniciales del usuario
  - `setupInitialDataLoad()` - Configura carga automática al login
  - `loadArtistPage(artistName)` - Carga página de artista
  - `openAlbumView(albumId, title, thumbnail)` - Abre vista de álbum

### 1️⃣1️⃣ **web/js/results.js** (231 líneas)
**Propósito:** Renderizado de resultados de búsqueda
**Exports:**
- `createResultsModule(config)` - Factory del módulo
  - `displayResults(categorizedSongs)` - Muestra resultados categorizados
**Categorías:** Canciones, Artistas, Álbumes, Playlists

### 1️⃣2️⃣ **web/js/right-panel.js** (607 líneas)
**Propósito:** Panel derecho con cola, letra y estadísticas
**Exports:**
- `createRightPanelModule(config)` - Factory del módulo
  - `initRightPanel()` - Inicializa pestañas y eventos
  - `renderQueue()` - Renderiza cola con drag & drop
  - `renderNowPlaying()` - Muestra canción actual con estadísticas
  - `loadAndDisplayLyrics(song)` - Carga y muestra letra
  - `updateLyrics(currentTime)` - Actualiza posición de letra
  - `highlightCurrentLyric(index)` - Resalta línea actual
  - `scrollToLyric(lineEl)` - Auto-scroll a línea actual

### 1️⃣3️⃣ **web/js/player-controls.js** (362 líneas)
**Propósito:** Controles del reproductor
**Exports:**
- `createPlayerControlsModule(config)` - Factory del módulo
  - `initControls()` - Inicializa todos los controles
  - `updatePlayPauseIcon()` - Actualiza icono play/pausa
  - `updateProgress()` - Actualiza barra de progreso
  - `setupAudioListeners()` - Configura eventos del audio
  - `nextSong()` - Siguiente canción
  - `prevSong()` - Canción anterior
**Características:**
- Drag en barra de progreso
- Control de volumen con drag
- Shuffle y repeat
- Eventos de teclado (espacio, flechas)

### 1️⃣4️⃣ **web/js/home.js** (1056 líneas)
**Propósito:** Vista principal con recomendaciones
**Exports:**
- `createHomeModule(config)` - Factory del módulo
  - `populateHomeCards()` - Genera toda la vista home
  - `generateRecommendations(recentlyPlayed)` - Crea playlists automáticas:
    - **Mix Diario:** 30 canciones aleatorias de artistas recientes
    - **Descubrimiento Semanal:** 50 canciones nuevas de artistas conocidos
    - **Radar de Novedades:** 40 canciones de artistas no escuchados
  - `refreshDiscoveryNow()` - Regenera Descubrimiento Semanal
  - `openPlaylistFromHome(playlist)` - Abre playlist desde home
  - `loadNovedades()` - Carga sección de novedades
  - `loadTendencias()` - Carga tendencias globales
  - `buildHomeDiscoverGrid()` - Grid de géneros musicales

### 1️⃣5️⃣ **web/script.js** (1463 líneas) - ORQUESTADOR PRINCIPAL
**Propósito:** Coordina todos los módulos y funcionalidad principal
**Estructura:**
1. **Variables globales** (líneas 1-45)
2. **Elementos DOM** (líneas 15-45)
3. **Inicialización de módulos** (líneas 47-450)
4. **Función principal de reproducción:** `playSongAtIndex(index)` (línea 840+)
5. **Gestión de auto-queue** (línea 480+)
6. **Modales y UI** (línea 646+)
7. **Event listeners globales** (línea 1380+)

---

## 🎯 Flujos de Funcionalidad Principales

### 🎵 Reproducir una Canción
```
1. Usuario hace click en canción
   ↓
2. setQueueAndPlayFromSongs() (queue.js)
   ↓
3. window.playSongAtIndex(index) (script.js:840)
   ↓
4. Crea Audio(), carga /audio?id=...
   ↓
5. setupAudioListeners() (player-controls.js)
   ↓
6. updateProgress() cada 100ms
   ↓
7. updateLyrics() con tiempo actual
   ↓
8. Al terminar: nextSong() automático
```

### 🔍 Búsqueda
```
1. Usuario escribe en #searchInput
   ↓
2. Debounce 300ms (script.js:448)
   ↓
3. searchSongs(query) (search.js)
   ↓
4. Cache check → fetch /search?q=...
   ↓
5. displayResults() (results.js)
   ↓
6. Renderiza categorías: Canciones, Artistas, Álbumes
```

### ❤️ Dar Like
```
1. Click en #playerLikeBtn
   ↓
2. toggleLike(currentSong) (likes.js)
   ↓
3. Actualiza array likedSongs
   ↓
4. saveLikedSong(token, song) (api.js)
   ↓
5. POST /liked-songs al backend
   ↓
6. updateLikeButton() - Actualiza UI
   ↓
7. Sincroniza playlist de favoritos
```

### 🏠 Cargar Home
```
1. showHomeView() (script.js)
   ↓
2. populateHomeCards() (home.js)
   ↓
3. Saludo dinámico según hora
   ↓
4. Grid 3x2 de recientes
   ↓
5. generateRecommendations()
   - Mix Diario
   - Descubrimiento Semanal
   - Radar de Novedades
   ↓
6. loadNovedades() y loadTendencias()
   ↓
7. Grid de géneros
```

---

## 🎨 Sistema de Estilos CSS

### Archivos CSS por Componente
```
web/
├── styles.css              # Estilos base y layout general
├── auth.css                # Login y registro
├── styles-sidebar.css      # Barra lateral
├── styles-topbar.css       # Barra superior
├── styles-home.css         # Vista home
├── styles-search.css       # Vista de búsqueda
├── styles-library.css      # Vista biblioteca
├── styles-songs.css        # Lista de canciones
├── styles-player.css       # Reproductor inferior
├── styles-right-panel.css  # Panel derecho
├── styles-artist.css       # Vista de artista
└── styles-lyrics.css       # Letra de canciones
```

---

## 🔐 Sistema de Autenticación

### Backend (Dart)
**Archivo:** `lib/auth.dart`
- JWT tokens con expiración
- Hash de contraseñas con bcrypt
- Validación de términos y condiciones

### Frontend
**Archivo:** `web/js/auth.js`
- Verifica token en localStorage
- Redirige a login si no autenticado
- Decodifica JWT para obtener username

### Flujo de Login
```
1. Usuario ingresa credenciales en login.html
   ↓
2. POST /login con username y password
   ↓
3. Backend valida contra SQLite
   ↓
4. Retorna { token, username, email }
   ↓
5. Frontend guarda en localStorage
   ↓
6. Redirige a index.html
   ↓
7. bootAuth() verifica token
   ↓
8. Carga datos del usuario
```

---

## 💾 Base de Datos (SQLite)

**Ubicación:** `data/esplotify.db`

### Tablas Principales
```sql
-- Usuarios
users (id, username, email, password_hash, birthdate, gender, created_at)

-- Canciones favoritas por usuario
liked_songs (id, user_id, song_id, song_data_json, created_at)

-- Playlists auto-generadas (Mix Diario, etc.)
auto_playlists (id, user_id, playlist_id, playlist_data_json, updated_at)

-- Historial de reproducción
recently_played (id, user_id, song_id, song_data_json, played_at)
```

---

## 🚀 Ejecución del Proyecto

### Backend
```bash
# Instalar dependencias
dart pub get

# Ejecutar servidor
dart run bin/servidor_esplotify.dart
```

**Servidor escucha en:** `http://localhost:3000`

### Frontend
- Abre `http://localhost:3000` en el navegador
- Login/Registro → Interfaz principal

---

## 🎛️ Variables de Configuración

### script.js (líneas 1-10)
```javascript
let currentAudio = null;          // Audio element actual
let playlist = [];                // Cola de reproducción
let currentIndex = -1;            // Índice de canción actual
let currentSong = null;           // Objeto de canción actual
let isLoading = false;            // Estado de carga
let currentVolume = 0.5;          // Volumen (0.0-1.0)
```

### Constantes de Playlists (storage.js)
```javascript
LIKED_SONGS_KEY = 'likedSongsPlaylist'
MADE_FOR_YOU_KEY = 'madeForYouPlaylists'
RECIENTES_PLAYLIST_ID = 'recently-played-auto'
```

### IDs de Playlists Automáticas (home.js)
```javascript
DISCOVERY_ID = 'weekly-discovery-auto'      // Descubrimiento Semanal
MIX_DIARIO_ID = 'mix-diario-auto'          // Mix Diario
RADAR_ID = 'radar-novedades-auto'          // Radar de Novedades
```

---

## 📊 Métricas del Proyecto

### Líneas de Código
- **script.js:** 1,463 líneas (orquestador)
- **Todos los módulos:** 3,769 líneas
- **Reducción del script principal:** ~70% (de ~5000 a 1463)

### Módulos
- **Total:** 14 módulos JavaScript
- **Patrón:** IIFE con factory functions
- **Dependencias:** Inyección de dependencias

### Arquitectura
- **Modular:** Separación de responsabilidades
- **Escalable:** Fácil añadir nuevos módulos
- **Mantenible:** Código organizado por dominio

---

## 🐛 Debugging

### Console Logs Importantes
```javascript
// Búsqueda
console.log('[search] Searching for:', query);

// Auto-queue
console.log('[auto-queue] Starting related queue for:', song.title);

// Playlists generadas
console.log('[MFY] Generated Mix Diario:', mixDiario);

// Sincronización
console.log('[sync] Saved to DB:', playlist.name);
```

### Variables Globales de Debug
```javascript
window.deletePlaylist          // Función de eliminación
window.playSongAtIndex        // Función de reproducción
window._displayResultsImpl    // Renderer de resultados
window._getPlaylistCover      // Obtener cover
window._initRightPanel        // Inicializar panel
window._populateHomeCards     // Renderizar home
```

---

## 🎓 Convenciones de Código

### Nomenclatura
- **Módulos:** `EsplotifyNombreModulo`
- **Funciones factory:** `createNombreModulo(config)`
- **Variables privadas:** `_variablePrivada`
- **Constantes:** `NOMBRE_CONSTANTE`
- **IDs de HTML:** `#camelCaseId`
- **Clases CSS:** `.kebab-case-class`

### Estructura de Módulo
```javascript
(function(global) {
    function createModuloNombre(config) {
        // Destructuring de config
        const { deps, state } = config;
        
        // Funciones privadas
        function funcionPrivada() { }
        
        // Funciones públicas
        function funcionPublica() { }
        
        // Return API pública
        return {
            funcionPublica,
        };
    }
    
    // Export global
    global.EsplotifyModulo = {
        createModuloNombre,
    };
})(window);
```

---

## 📖 Recursos Adicionales

### APIs Utilizadas
- **Fetch API:** Todas las llamadas HTTP
- **localStorage:** Persistencia cliente
- **Audio API:** Reproducción de audio
- **Drag & Drop API:** Reordenar cola

### Librerías Externas
- **Ninguna:** Proyecto 100% vanilla JavaScript

### Backend
- **Dart Shelf:** Framework HTTP
- **SQLite3:** Base de datos
- **JWT Dart:** Autenticación
- **BCrypt:** Hash de contraseñas

---

Esta guía documenta la arquitectura completa de Esplotify. Cada componente está modularizado y comentado para facilitar el mantenimiento y la extensión del proyecto.
