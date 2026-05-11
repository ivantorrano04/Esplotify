'use strict';

const { app, BrowserWindow, shell, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

let serverProcess = null;
let mainWindow = null;

// ── Paths ────────────────────────────────────────────────────────────────────
// When packaged by electron-builder, extraResources land in process.resourcesPath/server/
// When running in dev (electron .) they are in electron/resources/
function getServerDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'server')
        : path.join(__dirname, 'resources');
}

function getServerExe() {
    return path.join(getServerDir(), 'esplotify-server.exe');
}

// ── Start Dart backend ───────────────────────────────────────────────────────
function startServer() {
    const serverDir = getServerDir();
    const serverExe = getServerExe();
    const userDataDir = path.join(app.getPath('userData'), 'data');

    try {
        fs.mkdirSync(userDataDir, { recursive: true });
    } catch (err) {
        console.error('[electron] Failed to create user data dir:', err.message);
    }

    console.log('[electron] Starting server:', serverExe);
    console.log('[electron] Working dir:', serverDir);
    console.log('[electron] Data dir:', userDataDir);

    serverProcess = spawn(serverExe, [], {
        cwd: serverDir,   // Dart server resolves 'web/' and 'data/' relative to this
        stdio: 'pipe',
        windowsHide: true,
        env: {
            ...process.env,
            ESPLOTIFY_DATA_DIR: userDataDir,
        },
    });

    serverProcess.stdout.on('data', d => process.stdout.write('[server] ' + d));
    serverProcess.stderr.on('data', d => process.stderr.write('[server] ' + d));
    serverProcess.on('error', err => {
        console.error('[electron] Server process error:', err.message);
    });
    serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
            console.error('[electron] Server exited with code:', code);
        }
    });
}

// ── Wait until port is available ─────────────────────────────────────────────
function waitForPort(port, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;

        const attempt = () => {
            const sock = new net.Socket();
            sock.setTimeout(400);

            sock.connect(port, '127.0.0.1', () => {
                sock.destroy();
                resolve();
            });

            sock.on('error', () => {
                sock.destroy();
                if (Date.now() >= deadline) {
                    reject(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
                } else {
                    setTimeout(attempt, 250);
                }
            });

            sock.on('timeout', () => {
                sock.destroy();
                if (Date.now() >= deadline) {
                    reject(new Error('Timeout'));
                } else {
                    setTimeout(attempt, 250);
                }
            });
        };

        attempt();
    });
}

// ── Create main window ───────────────────────────────────────────────────────
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 920,
        minHeight: 620,
        backgroundColor: '#121212',
        title: 'Esplotify',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            devTools: !app.isPackaged,
        },
        show: false,
    });

    // Hide browser's native menu bar (F11 still works for fullscreen)
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();

    // Open external links in the real browser, not inside Electron
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Show window only once content is ready (avoids white flash)
    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.loadURL('http://localhost:3000');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    // Limpiar caché HTTP de Chromium para que siempre cargue CSS/JS actualizados
    // sin esto, al actualizar la app el navegador sigue usando versiones cacheadas
    await session.defaultSession.clearCache();

    startServer();

    try {
        // Show a loading indicator in the taskbar while waiting
        if (process.platform === 'win32') {
            app.setAppUserModelId('com.esplotify.app');
        }

        console.log('[electron] Waiting for server on port 3000…');
        await waitForPort(3000, 20000);
        console.log('[electron] Server ready — opening window.');
        createWindow();
    } catch (err) {
        console.error('[electron] Failed to connect to server:', err.message);
        // Show a minimal error window
        const errWin = new BrowserWindow({ width: 480, height: 220, resizable: false, backgroundColor: '#121212' });
        errWin.removeMenu();
        errWin.loadURL(`data:text/html,<body style="font-family:sans-serif;color:#fff;background:#121212;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px">
            <h2 style="margin:0">No se pudo iniciar Esplotify</h2>
            <p style="opacity:.6;margin:0">El servidor interno no respondió. Intenta reiniciar la app.</p>
            <button onclick="require('electron').remote.app.quit()" style="padding:8px 24px;border-radius:20px;border:0;background:#1db954;color:#000;font-size:14px;cursor:pointer">Cerrar</button>
        </body>`);
    }
});

app.on('window-all-closed', () => {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
    app.quit();
});

app.on('before-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
});
