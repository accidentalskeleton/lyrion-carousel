# Run the portable server without installing a service or requiring Administrator.
param(
    [string]$LmsUrl = 'http://streamer:9000',
    [ValidateRange(1,65535)][int]$Port = 18088
)
$ErrorActionPreference = 'Stop'
$executable = Join-Path $PSScriptRoot 'app\LyrionCarousel.exe'
if (-not (Test-Path $executable)) { throw "Missing packaged Carousel: $executable" }
$cache = Join-Path $env:LOCALAPPDATA 'LyrionCarousel\cache\album-art'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
Write-Host "Open http://127.0.0.1:$Port/ (Ctrl+C to stop)."
& $executable --bind '127.0.0.1' --port $Port --lms $LmsUrl --cache-dir $cache
if ($LASTEXITCODE -ne 0) { throw "LyrionCarousel exited with status $LASTEXITCODE" }
