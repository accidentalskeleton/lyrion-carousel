# Install Lyrion Carousel as a Windows service (administrator PowerShell required).
# Installs into Program Files so a low-privilege local user cannot replace service binaries.
param(
    [string]$LmsUrl = 'http://streamer:9000',
    [ValidateRange(1, 65535)][int]$Port = 18088
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as Administrator to install the Windows service.'
}
$uri = $null
if (-not [Uri]::TryCreate($LmsUrl,[UriKind]::Absolute,[ref]$uri) -or
    $uri.Scheme -notin @('http','https') -or -not $uri.Host -or $uri.UserInfo) {
    throw 'LmsUrl must be an HTTP(S) URL without embedded credentials.'
}
if (Get-Service -Name 'LyrionCarousel' -ErrorAction SilentlyContinue) {
    throw 'LyrionCarousel service is already installed. Run Uninstall-Service.ps1 before reinstalling/upgrading.'
}

$installDir = Join-Path $env:ProgramFiles 'LyrionCarousel'
$sourceDir = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$destDir = [IO.Path]::GetFullPath($installDir).TrimEnd('\')
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
if ($sourceDir -ine $destDir) {
    $existingApp = Join-Path $installDir 'app'
    if (Test-Path $existingApp) { Remove-Item -Recurse -Force $existingApp }
    Copy-Item -Path (Join-Path $PSScriptRoot 'app') -Destination $existingApp -Recurse
    foreach ($name in @('LyrionCarouselService.exe','LyrionCarouselService.xml',
                        'Install-Service.ps1','Uninstall-Service.ps1','Start-Carousel.ps1',
                        'README-Windows.md','VERSION','LICENSE.txt',
                        'THIRD_PARTY_NOTICES.md','WinSW-LICENSE.txt')) {
        Copy-Item (Join-Path $PSScriptRoot $name) (Join-Path $installDir $name) -Force
    }
}

$dataRoot = Join-Path $env:ProgramData 'LyrionCarousel'
foreach ($relative in @('cache\album-art','logs')) {
    $folder = Join-Path $dataRoot $relative
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    # LocalService SID; account names are localized, whereas the SID is stable.
    & icacls.exe $folder /grant '*S-1-5-19:(OI)(CI)M' /T | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not grant LocalService write access: $folder" }
}

$configPath = Join-Path $installDir 'LyrionCarouselService.xml'
[xml]$config = Get-Content -Raw $configPath
$config.service.arguments = ('--bind 127.0.0.1 --port {0} --lms "{1}" --cache-dir "%ProgramData%\LyrionCarousel\cache\album-art"' -f $Port, $uri.AbsoluteUri.TrimEnd('/'))
$config.Save($configPath)

$wrapper = Join-Path $installDir 'LyrionCarouselService.exe'
& $wrapper install
if ($LASTEXITCODE -ne 0) { throw "WinSW service install failed ($LASTEXITCODE)." }
& $wrapper start
if ($LASTEXITCODE -ne 0) { throw "Service installed, but startup failed ($LASTEXITCODE). Check $dataRoot\logs" }

Write-Host "Lyrion Carousel installed as a LocalService Windows service."
Write-Host "Open http://127.0.0.1:$Port/ after the service starts."
Write-Host "Service logs: $dataRoot\logs"
