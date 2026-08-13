param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$setup = Get-ChildItem -LiteralPath $source -Filter "*.exe" |
  Where-Object { $_.Name -match "Setup" } |
  Select-Object -First 1
$portable = Get-ChildItem -LiteralPath $source -Filter "*.exe" |
  Where-Object { $_.Name -match "Portable" -or $_.Name -notmatch "Setup" } |
  Select-Object -First 1
if (-not $setup -or -not $portable) {
  throw "Setup and portable executables are both required for package smoke testing."
}

$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) ("latex-project-manager-package-smoke-" + [guid]::NewGuid().ToString("N"))
$installDirectory = Join-Path $smokeRoot "installed"
$installedUserData = Join-Path $smokeRoot "installed-user-data"
$portableUserData = Join-Path $smokeRoot "portable-user-data"
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
$portableProcess = $null

function Stop-ProcessTreeBestEffort([int]$ProcessId) {
  & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
  # A child may exit between enumeration and taskkill. That is already the
  # desired cleanup result and must not turn a successful smoke test red.
  $global:LASTEXITCODE = 0
}

function Assert-SmokePath([string]$Path) {
  $absolute = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetFullPath($smokeRoot) + [IO.Path]::DirectorySeparatorChar
  if (-not $absolute.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Package smoke path escaped its private temporary directory: $absolute"
  }
}

try {
  Assert-SmokePath $installDirectory
  $installer = Start-Process -FilePath $setup.FullName -ArgumentList "/S", "/D=$installDirectory" -Wait -PassThru -WindowStyle Hidden
  if ($installer.ExitCode -ne 0) { throw "Silent Setup installation failed with exit code $($installer.ExitCode)." }
  $installedExe = Get-ChildItem -LiteralPath $installDirectory -Filter "*.exe" |
    Where-Object { $_.Name -notmatch "Uninstall|elevate" } |
    Select-Object -First 1
  if (-not $installedExe) { throw "Setup completed without installing the application executable." }

  $env:ELECTRON_SMOKE_EXECUTABLE = $installedExe.FullName
  $env:ELECTRON_SMOKE_USER_DATA = $installedUserData
  & node (Join-Path $projectRoot "tests\electron-smoke.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Installed application smoke test failed." }

  $uninstaller = Get-ChildItem -LiteralPath $installDirectory -Filter "*.exe" |
    Where-Object { $_.Name -match "Uninstall" } |
    Select-Object -First 1
  if (-not $uninstaller) { throw "Setup did not install an uninstaller." }
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
  if ($uninstall.ExitCode -ne 0) { throw "Silent uninstall failed with exit code $($uninstall.ExitCode)." }
  $uninstallDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $uninstallDeadline -and (Test-Path -LiteralPath $installedExe.FullName)) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $installedExe.FullName) { throw "Uninstaller returned successfully but left the application executable behind." }

  New-Item -ItemType Directory -Path $portableUserData -Force | Out-Null
  $portableProcess = Start-Process -FilePath $portable.FullName -ArgumentList "--user-data-dir=$portableUserData" -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $portableDatabase = Join-Path $portableUserData "library.sqlite"
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $portableDatabase)) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $portableDatabase)) {
    throw "Portable application did not initialize its SQLite catalog within 30 seconds."
  }
  Stop-ProcessTreeBestEffort $portableProcess.Id
  [void]$portableProcess.WaitForExit(5000)
  $portableProcess.Refresh()
  Write-Host "Windows Setup install/uninstall and portable startup smoke tests passed."
} finally {
  if ($portableProcess -and -not $portableProcess.HasExited) {
    Stop-ProcessTreeBestEffort $portableProcess.Id
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($portableUserData) } |
    ForEach-Object { Stop-ProcessTreeBestEffort $_.ProcessId }
  Remove-Item Env:ELECTRON_SMOKE_EXECUTABLE -ErrorAction SilentlyContinue
  Remove-Item Env:ELECTRON_SMOKE_USER_DATA -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $smokeRoot) {
    Assert-SmokePath (Join-Path $smokeRoot "cleanup-sentinel")
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  $global:LASTEXITCODE = 0
}
