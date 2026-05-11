/**
 * ========================================
 * MÓDULO DE AUTENTICACIÓN - Sistema de Login
 * ========================================
 * Propósito: Gestiona autenticación y sesión del usuario
 * 
 * Funcionalidades:
 * - Verificar si el usuario está logueado
 * - Mostrar/ocultar menú de perfil
 * - Cerrar sesión
 * - Inicializar aplicación con verificación de token
 */
(function () {
    function createAuthModule(deps) {
        const {
            madeForYouKey,
            initRightPanel,
        } = deps;

        /**
         * Verifica si el usuario está logueado
         * @returns {boolean} True si existe token en localStorage
         */
        function isLoggedIn() {
            return !!localStorage.getItem('token');
        }

        /**
         * Verifica el estado de autenticación y actualiza la UI del perfil
         * Muestra el nombre de usuario o "Iniciar Sesión" según corresponda
         */
        function checkAuthStatus() {
            const displayEl = document.getElementById('profileTooltip');
            const nameDisplayEl = document.getElementById('userInitial');
            if (!displayEl) return;

            const token = localStorage.getItem('token');
            let user = null;
            try {
                user = JSON.parse(localStorage.getItem('user') || 'null');
            } catch (_) {
                localStorage.removeItem('user');
                user = null;
            }

            // Actualiza el texto del tooltip y la inicial
            if (token && user && user.username) {
                displayEl.textContent = user.username;
                if (nameDisplayEl) nameDisplayEl.textContent = user.username.charAt(0).toUpperCase();
            } else {
                displayEl.textContent = 'Iniciar Sesion';
                if (nameDisplayEl) nameDisplayEl.textContent = 'I';
            }
        }

        /**
         * Cierra el menú desplegable de perfil
         */
        function closeProfileMenu() {
            const profileMenu = document.getElementById('profileMenu');
            const profileTooltip = document.getElementById('profileTooltip');
            if (profileMenu) profileMenu.classList.remove('show');
            if (profileTooltip) profileTooltip.classList.remove('show');
        }

        /**
         * Limpia todos los datos del usuario de localStorage
         * Elimina: token, user, playlists, favoritos, historial
         */
        function clearUserLocalStorage() {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem(madeForYouKey);
            localStorage.removeItem('likedSongs');
            localStorage.removeItem('recentlyPlayed');
            localStorage.removeItem('recientesPlaylistId');
            localStorage.removeItem('lastUserId');
        }

        /**
         * Cierra la sesión del usuario
         * Limpia localStorage y redirige a login
         */
        function logout() {
            clearUserLocalStorage();
            window.location.href = 'login.html';
        }

        /**
         * Maneja el click en el botón de perfil
         * Si no está logueado → redirige a login
         * Si está logueado → abre/cierra el menú de perfil
         */
        function handleProfileClick() {
            const token = localStorage.getItem('token');
            if (!token) {
                window.location.href = 'login.html';
                return;
            }
            const profileMenu = document.getElementById('profileMenu');
            const profileTooltip = document.getElementById('profileTooltip');
            if (!profileMenu || !profileTooltip) return;

            // Toggle del menú de perfil
            if (profileMenu.classList.contains('show')) {
                profileMenu.classList.remove('show');
                profileTooltip.classList.remove('show');
            } else {
                profileMenu.classList.add('show');
                profileTooltip.classList.add('show');
            }
        }

        /**
         * Inicializa la UI de autenticación
         * - Verifica que haya token y usuario válido
         * - Si el usuario cambió, limpia los datos del anterior
         * - Actualiza el estado de autenticación
         * - Configura listeners para cambios de storage (logout en otra pestaña)
         */
        function initAuthUI() {
            const token = localStorage.getItem('token');
            let user = null;
            try {
                user = JSON.parse(localStorage.getItem('user') || 'null');
            } catch (_) {
                localStorage.removeItem('user');
                user = null;
            }

            // Si no hay token o usuario válido, redirige a login
            if (!token || !user || !user.username) {
                window.location.href = 'login.html';
                return;
            }

            // Detecta cambio de usuario y limpia datos del anterior
            const lastUserId = localStorage.getItem('lastUserId');
            const currentUserId = String(user.id ?? user.username);
            if (lastUserId && lastUserId !== currentUserId) {
                // Limpia playlists automáticas, favoritos e historial del usuario anterior
                localStorage.removeItem(madeForYouKey);
                localStorage.removeItem('likedSongs');
                localStorage.removeItem('recentlyPlayed');
                localStorage.removeItem('recientesPlaylistId');
            }
            localStorage.setItem('lastUserId', currentUserId);
            checkAuthStatus();

            // Escucha cambios de storage en otras pestañas (ej: logout en otra pestaña)
            window.addEventListener('storage', (e) => {
                if (e.key === 'token' || e.key === 'user') checkAuthStatus();
            });
        }

        /**
         * Configura los event listeners del menú de perfil
         * - Click en botón de perfil para abrir/cerrar menú
         * - Click fuera del menú para cerrarlo
         * - Click en items del menú (Cuenta, Perfil, Soporte, etc.)
         */
        function bindProfileMenuActions() {
            // Bind del botón de perfil
            const profileBtn = document.getElementById('profileBtn');
            if (profileBtn) {
                profileBtn.addEventListener('click', handleProfileClick);
            } else {
                // Si el botón no existe aún, espera al DOMContentLoaded
                document.addEventListener('DOMContentLoaded', () => {
                    const pb = document.getElementById('profileBtn');
                    if (pb) pb.addEventListener('click', handleProfileClick);
                });
            }

            // Cierra el menú si se hace click fuera de él
            document.addEventListener('click', (e) => {
                const profileMenu = document.getElementById('profileMenu');
                const profileTooltip = document.getElementById('profileTooltip');
                const btn = document.getElementById('profileBtn');
                if (!profileMenu || !profileTooltip || !btn) return;
                // Si el click no fue en el botón ni en el menú, cierra el menú
                if (!btn.contains(e.target) && !profileMenu.contains(e.target)) {
                    profileMenu.classList.remove('show');
                    profileTooltip.classList.remove('show');
                }
            });

            // Configura los clicks en los items del menú de perfil
            document.addEventListener('DOMContentLoaded', () => {
                // Item 1: Cuenta (funcionalidad futura)
                const accountItem = document.querySelector('.profile-menu-item:nth-child(1)');
                if (accountItem) accountItem.addEventListener('click', () => { alert('Funcionalidad de Cuenta proximamente disponible'); closeProfileMenu(); });
                
                // Item 2: Perfil (funcionalidad futura)
                const profileItem = document.querySelector('.profile-menu-item:nth-child(2)');
                if (profileItem) profileItem.addEventListener('click', () => { alert('Funcionalidad de Perfil proximamente disponible'); closeProfileMenu(); });
                
                // Item 3: Soporte (funcionalidad futura)
                const supportItem = document.querySelector('.profile-menu-item:nth-child(3)');
                if (supportItem) supportItem.addEventListener('click', () => { alert('Funcionalidad de Soporte proximamente disponible'); closeProfileMenu(); });
                
                // Item 4: Sesión privada
                const privateSessionItem = document.querySelector('.profile-menu-item:nth-child(4)');
                if (privateSessionItem) privateSessionItem.addEventListener('click', () => { alert('Sesion privada activada'); closeProfileMenu(); });
                
                // Item 5: Configuración (funcionalidad futura)
                const settingsItem = document.querySelector('.profile-menu-item:nth-child(5)');
                if (settingsItem) settingsItem.addEventListener('click', () => { alert('Funcionalidad de Configuracion proximamente disponible'); closeProfileMenu(); });
                
                // Item de Cerrar sesión
                const logoutItem = document.querySelector('.profile-menu-item[data-action="logout"]');
                if (logoutItem) logoutItem.addEventListener('click', () => { logout(); closeProfileMenu(); });
            });
        }

        /**
         * Función de arranque principal del módulo de autenticación
         * - Inicializa la UI de autenticación
         * - Inicializa el panel derecho
         * - Configura las acciones del menú de perfil
         * 
         * Se ejecuta automáticamente al cargar el módulo
         */
        function boot() {
            if (document.readyState === 'loading') {
                // Si el DOM aún está cargando, espera a DOMContentLoaded
                document.addEventListener('DOMContentLoaded', () => {
                    initAuthUI();
                    initRightPanel();
                });
            } else {
                // Si el DOM ya está listo, ejecuta inmediatamente
                initAuthUI();
                initRightPanel();
            }
            bindProfileMenuActions();
        }

        // API pública del módulo
        return {
            isLoggedIn,              // Verifica si hay sesión activa
            checkAuthStatus,         // Actualiza UI del perfil
            initAuthUI,              // Inicializa autenticación
            closeProfileMenu,        // Cierra menú de perfil
            clearUserLocalStorage,   // Limpia datos de usuario
            logout,                  // Cierra sesión
            boot,                    // Arranque principal
        };
    }

    // Exporta el módulo al objeto global
    window.EsplotifyAuth = {
        createAuthModule,
    };
})();
