# TODO: Implementar persistencia de datos para playlists autogeneradas

## Backend Changes (main.dart)
- [ ] Agregar nueva ruta PUT /replace-playlist-songs
  - Aceptar playlist_id y songs en el body
  - Eliminar canciones actuales de playlist_songs para esa playlist
  - Agregar las nuevas canciones
  - Retornar éxito/error

## Frontend Changes (script.js)
- [ ] Modificar updateStoredRecientesPlaylist
  - Buscar/crear playlist "Recientes" en DB
  - Usar nueva ruta /replace-playlist-songs para actualizar
  - Almacenar playlistId en localStorage después de crear

- [ ] Modificar refreshDiscoveryNow
  - Buscar/crear playlist "Descubrimiento Semanal" en DB
  - Usar nueva ruta /replace-playlist-songs para actualizar
  - Almacenar playlistId en localStorage

- [ ] Modificar loadUserData y showHomeView
  - Obtener playlists "Recientes" y "Descubrimiento Semanal" desde /user-playlists
  - Usar /playlist-songs para obtener las canciones
  - Eliminar dependencia de localStorage para estas playlists

## Testing
- [ ] Verificar que "Recientes" se persista correctamente
- [ ] Verificar que "Descubrimiento Semanal" se actualice en DB
- [ ] Verificar que las playlists aparezcan al cargar la vista home
