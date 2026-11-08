# Build the portable Windows server and optional WinSW service installer.
# Run on Windows after installing Pillow and PyInstaller in the current Python environment.
param(
    [string]$OutputDirectory = ""
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'dist' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path

$version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
if ($version -notmatch '^[0-9A-Za-z.+~-]+$') { throw "Invalid VERSION: $version" }
$packageName = "LyrionCarousel-Windows-x64-v$version"
$staging = Join-Path $OutputDirectory $packageName
$buildRoot = Join-Path $OutputDirectory '.windows-build'
$pyDist = Join-Path $buildRoot 'dist'
$archive = Join-Path $OutputDirectory "$packageName.zip"

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

$pyinstallerArgs = @(
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
    '--name', 'LyrionCarousel',
    '--distpath', $pyDist, '--workpath', (Join-Path $buildRoot 'work'),
    '--specpath', $buildRoot,
    '--add-data', "${root}\index.html:.", '--add-data', "${root}\manifest.webmanifest:.",
    '--add-data', "${root}\spotty-diagnostic.html:.", '--add-data', "${root}\VERSION:.",
    '--add-data', "${root}\assets:assets", '--add-data', "${root}\css:css", '--add-data', "${root}\js:js",
    'server.py'
)
Push-Location $root
try {
    & python @pyinstallerArgs
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$builtApp = Join-Path $pyDist 'LyrionCarousel'
if (-not (Test-Path (Join-Path $builtApp 'LyrionCarousel.exe'))) {
    throw "Missing PyInstaller output at $builtApp"
}
Copy-Item -Path $builtApp -Destination (Join-Path $staging 'app') -Recurse
foreach ($file in @('Install-Service.ps1', 'Uninstall-Service.ps1',
                     'Start-Carousel.ps1', 'LyrionCarouselService.xml')) {
    $source = Join-Path $PSScriptRoot $file
    if (-not (Test-Path $source)) { throw "Missing packaging file: $source" }
    Copy-Item $source $staging
}
# Distribute the canonical Windows guide as README-Windows.md in each ZIP.
$windowsGuide = Join-Path $root 'docs\windows.md'
if (-not (Test-Path $windowsGuide)) { throw "Missing Windows guide: $windowsGuide" }
Copy-Item $windowsGuide (Join-Path $staging 'README-Windows.md')
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $staging 'LICENSE.txt')
Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.md') $staging
Copy-Item (Join-Path $root 'VERSION') $staging

# Pin to an upstream WinSW release, never fetch an unversioned "latest" binary.
$winswVersion = 'v2.12.0'
$winswUrl = "https://github.com/winsw/winsw/releases/download/$winswVersion/WinSW-x64.exe"
$licenseUrl = "https://raw.githubusercontent.com/winsw/winsw/$winswVersion/LICENSE.txt"
$winswPath = Join-Path $staging 'LyrionCarouselService.exe'
Invoke-WebRequest -Uri $winswUrl -OutFile $winswPath
if ((Get-Item $winswPath).Length -lt 1000000) { throw 'WinSW binary download is incomplete' }
Invoke-WebRequest -Uri $licenseUrl -OutFile (Join-Path $staging 'WinSW-LICENSE.txt')

# A ZIP retains the PyInstaller support directory and all service components.
if (Test-Path $archive) { Remove-Item $archive -Force }
Compress-Archive -Path $staging -DestinationPath $archive -CompressionLevel Optimal
if (-not (Test-Path $archive)) { throw 'Windows ZIP not created' }
$sha = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
Set-Content -Path "$archive.sha256" -Value "$sha  $packageName.zip" -Encoding ascii
Write-Host "Windows package: $archive"
Write-Host "SHA-256: $sha"
