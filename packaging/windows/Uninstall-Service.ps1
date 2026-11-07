# Unregister the service. Leave files, configuration and artwork cache intact.
# Requires an elevated Administrator PowerShell.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run PowerShell as Administrator to uninstall the Windows service.'
}
if (-not (Get-Service -Name 'LyrionCarousel' -ErrorAction SilentlyContinue)) {
    Write-Host 'LyrionCarousel is not registered as a Windows service.'
    return
}
$wrapper = Join-Path (Join-Path $env:ProgramFiles 'LyrionCarousel') 'LyrionCarouselService.exe'
if (-not (Test-Path $wrapper)) { throw "Service wrapper not found: $wrapper" }
& $wrapper stop
if ($LASTEXITCODE -ne 0) { throw "WinSW could not stop the service ($LASTEXITCODE)" }
& $wrapper uninstall
if ($LASTEXITCODE -ne 0) { throw "WinSW could not unregister the service ($LASTEXITCODE)" }
Write-Host 'Service uninstalled. Program Files binaries and ProgramData caches/logs were retained.'
Write-Host 'Remove these folders manually only when they are no longer needed.'
