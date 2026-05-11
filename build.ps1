# build.ps1 - Empaqueta Esplotify como instalador .exe
# Requiere: Dart SDK en PATH, Node.js + npm en PATH
# Resultado: dist/Esplotify Setup 1.0.0.exe

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "=== Esplotify Builder ===" -ForegroundColor Cyan
Write-Host ""

foreach ($cmd in 'dart', 'node', 'npm') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "$cmd no encontrado en PATH. Instalalo antes de continuar."
        exit 1
    }
}

$res = Join-Path $PSScriptRoot "electron\resources"
$lib = Join-Path $PSScriptRoot "electron\lib"
New-Item -ItemType Directory -Force -Path $res | Out-Null
New-Item -ItemType Directory -Force -Path "$res\data" | Out-Null
New-Item -ItemType Directory -Force -Path $lib | Out-Null

Write-Host "[1/5] Compilando servidor Dart..." -ForegroundColor Yellow
dart build cli
$builtExe = Join-Path $PSScriptRoot "build\cli\windows_x64\bundle\bin\servidor_esplotify.exe"
if (-not (Test-Path $builtExe)) {
    Write-Error "La compilacion Dart fallo. Revisa los errores anteriores."
    exit 1
}
$serverExe = Join-Path $res "esplotify-server.exe"
Copy-Item $builtExe $serverExe -Force
# Copiar DLLs nativas del bundle a electron/lib/ (ruta esperada: ../lib/ relativo al exe)
# El codigo generado por Dart native assets carga DLLs desde ../lib/ relativo al ejecutable
$bundleLib = Join-Path $PSScriptRoot "build\cli\windows_x64\bundle\lib"
if (Test-Path $bundleLib) {
    Get-ChildItem $bundleLib -Filter "*.dll" | ForEach-Object { Copy-Item $_.FullName $lib -Force }
}
Write-Host "      OK: $serverExe" -ForegroundColor Green

Write-Host "[2/5] Copiando carpeta web..." -ForegroundColor Yellow
$webDest = Join-Path $res "web"
if (Test-Path $webDest) { Remove-Item $webDest -Recurse -Force }
Copy-Item -Recurse -Force (Join-Path $PSScriptRoot "web") $webDest
Write-Host "      OK: $webDest" -ForegroundColor Green

Write-Host "[3/5] Buscando sqlite3.dll..." -ForegroundColor Yellow
# sqlite3.dll debe ir en electron/lib/ para que quede en resources/lib/ en el paquete
# El exe generado por Dart native assets busca la DLL en ../lib/ relativo a su ubicacion
$sqliteDll = Join-Path $lib "sqlite3.dll"
if (Test-Path $sqliteDll) {
    Write-Host "      OK: ya presente." -ForegroundColor Green
} else {
    $pubCache = Join-Path $env:LOCALAPPDATA "Pub\Cache\hosted\pub.dev"
    $found = Get-ChildItem -Path $pubCache -Recurse -Filter "sqlite3.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        Copy-Item $found.FullName $sqliteDll
        Write-Host "      OK: copiado desde pub-cache." -ForegroundColor Green
    } else {
        $zipPath = Join-Path $env:TEMP "sqlite3-win-x64.zip"
        $sqliteUrl = "https://www.sqlite.org/2024/sqlite-dll-win-x64-3460100.zip"
        try {
            Invoke-WebRequest -Uri $sqliteUrl -OutFile $zipPath -UseBasicParsing
            Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
            $downloaded = Join-Path $env:TEMP "sqlite3.dll"
            if (Test-Path $downloaded) {
                Move-Item $downloaded $sqliteDll -Force
                Write-Host "      OK: descargado." -ForegroundColor Green
            }
        } catch {
            Write-Warning "No se pudo descargar sqlite3.dll. Descargalo de https://sqlite.org/download.html"
            Write-Warning "Busca sqlite-dll-win-x64-*.zip y copia sqlite3.dll a: $sqliteDll"
        }
    }
}

Write-Host "[4/5] Comprobando icono..." -ForegroundColor Yellow
$icon = Join-Path $PSScriptRoot "electron\icon.ico"
if (-not (Test-Path $icon)) {
    Write-Host "      Sin icon.ico - icono por defecto de Electron." -ForegroundColor DarkYellow
    # No modificar package.json — ya no tiene referencia a icon, todo OK
} else {
    Write-Host "      OK: $icon" -ForegroundColor Green
}

Write-Host "[5/5] Instalando npm y construyendo instalador..." -ForegroundColor Yellow
Set-Location (Join-Path $PSScriptRoot "electron")
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Error "npm install fallo."; exit 1 }
npm run dist
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder fallo."; exit 1 }
Set-Location $PSScriptRoot

Write-Host ""
$installer = Get-ChildItem -Path (Join-Path $PSScriptRoot "dist") -Filter "*.exe" -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -match 'Setup' } |
             Select-Object -First 1
if ($installer) {
    Write-Host "=== Listo! ===" -ForegroundColor Green
    Write-Host "Instalador: $($installer.FullName)" -ForegroundColor White
} else {
    Write-Warning "No se encontro el instalador en dist/."
}
Write-Host ""
