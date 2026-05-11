/**
 * ========================================
 * MÓDULO DE UTILIDADES - Esplotify
 * ========================================
 * Propósito: Funciones auxiliares compartidas por toda la aplicación
 * 
 * Exports:
 * - readJsonResponse: Parse seguro de respuestas JSON
 * - normalizeSongTitle: Normaliza títulos de canciones para comparación
 * - dedupeSongsByTitle: Elimina canciones duplicadas
 * - isTooLong: Filtra canciones muy largas (>7 minutos)
 * - titleAlreadySeen: Detecta títulos similares
 * - formatDuration: Convierte segundos a formato "m:ss"
 */
(function () {
    /**
     * Lee y parsea una respuesta HTTP como JSON de forma segura
     * @param {Response} response - Respuesta fetch
     * @returns {Promise<{data: any, raw: string}>} Datos parseados y texto raw
     */
    function readJsonResponse(response) {
        return response.text().then((raw) => {
            let data = null;
            try {
                // Intenta parsear el JSON, si falla retorna null
                data = raw ? JSON.parse(raw) : null;
            } catch (_) {
                data = null;
            }
            return { data, raw };
        });
    }

    /**
     * Normaliza el título de una canción para comparación
     * Elimina: acentos, paréntesis, palabras comunes (remix, live, etc.)
     * @param {string} title - Título original
     * @returns {string} Título normalizado en minúsculas
     */
    function normalizeSongTitle(title) {
        return String(title || '')
            .toLowerCase()
            .normalize('NFD')  // Descompone caracteres acentuados
            .replace(/[\u0300-\u036f]/g, '')  // Elimina acentos
            .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')  // Elimina paréntesis y corchetes
            .replace(/\b(remaster(?:ed)?|live|official|audio|video|lyrics?|lyric|version|mix|edit)\b/g, ' ')  // Elimina palabras comunes
            .replace(/[^a-z0-9]/g, ' ')  // Solo letras y números
            .replace(/\s+/g, ' ')  // Espacios múltiples → uno solo
            .trim();
    }

    /**
     * Elimina canciones duplicadas basándose en títulos normalizados
     * @param {Array} songs - Array de objetos canción
     * @returns {Array} Array sin duplicados
     */
    function dedupeSongsByTitle(songs) {
        const out = [];
        const seenTitles = new Set();
        for (const song of (songs || [])) {
            const key = normalizeSongTitle(song && song.title);
            if (!key || seenTitles.has(key)) continue;  // Ya vista
            seenTitles.add(key);
            out.push(song);
        }
        return out;
    }

    /**
     * Verifica si una canción es demasiado larga (>7 minutos)
     * @param {Object} song - Objeto canción con propiedad duration
     * @returns {boolean} True si es muy larga
     */
    function isTooLong(song) {
        return song && Number(song.duration) > 420;  // 420 segundos = 7 minutos
    }

    /**
     * Verifica si un título ya fue visto (con detección de similitud)
     * @param {string} titleKey - Título normalizado
     * @param {Set} seenTitles - Set de títulos ya vistos
     * @returns {boolean} True si ya existe o es muy similar
     */
    function titleAlreadySeen(titleKey, seenTitles) {
        if (!titleKey) return true;
        if (seenTitles.has(titleKey)) return true;
        if (titleKey.length < 4) return false;
        // Busca títulos que contengan o estén contenidos en el título actual
        for (const seen of seenTitles) {
            if (seen.length >= 4 && (seen.includes(titleKey) || titleKey.includes(seen))) return true;
        }
        return false;
    }

    /**
     * Formatea segundos a formato de duración "m:ss"
     * @param {number} seconds - Duración en segundos
     * @returns {string} Duración formateada (ej: "3:45")
     */
    function formatDuration(seconds) {
        if (!seconds || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Exporta todas las utilidades al objeto global
    window.EsplotifyUtils = {
        readJsonResponse,
        normalizeSongTitle,
        dedupeSongsByTitle,
        isTooLong,
        titleAlreadySeen,
        formatDuration,
    };
})();
