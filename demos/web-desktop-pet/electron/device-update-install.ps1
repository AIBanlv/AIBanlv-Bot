param(
  [Parameter(Mandatory=$true)][int]$ParentId,
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$Sha256,
  [Parameter(Mandatory=$true)][long]$Bytes,
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [Parameter(Mandatory=$true)][string]$Receipt,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$CancelFile
)
$ErrorActionPreference = 'Stop'
$armed = $false
$stage = 'verify'
function Write-Receipt($value) {
  $temporary = "$Receipt.$Token.tmp"
  $json = $value | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
  # PowerShell 5 binds $null to an empty string for this .NET string argument.
  # NullString preserves a null backup path and allows atomic replacement.
  if ([IO.File]::Exists($Receipt)) { [IO.File]::Replace($temporary, $Receipt, [NullString]::Value) }
  else { [IO.File]::Move($temporary, $Receipt) }
}
function Save-Status([string]$status) {
  Write-Receipt @{ status = $status; token = $Token; pid = $PID; stage = $stage }
}
function Verify-Installer {
  $item = Get-Item -LiteralPath $Installer
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne $Bytes) { throw 'Invalid installer size' }
  if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ne $Sha256) { throw 'Invalid installer hash' }
  $marker = Join-Path $InstallDirectory '.control-device-install'
  if ([IO.File]::ReadAllText($marker) -cne "Control Device`r`n") { throw 'Invalid installation marker' }
}
try {
  if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $Bytes -le 0 -or $Bytes -gt 8589934592) { throw 'Invalid manifest' }
  if (-not [IO.Path]::IsPathRooted($Installer) -or -not [IO.Path]::IsPathRooted($InstallDirectory)) { throw 'Invalid path' }
  if ($Installer -match '[\r\n"]' -or $InstallDirectory -match '[\r\n"]') { throw 'Invalid path' }
  $parent = Get-Process -Id $ParentId
  # Hold the process handle, so PID reuse cannot make us wait on another app.
  $null = $parent.Handle
  Verify-Installer
  if (Test-Path -LiteralPath $CancelFile) { throw 'Preparation was cancelled' }
  $stage = 'wait-parent'
  Save-Status 'armed'
  $armed = $true
  if (-not $parent.WaitForExit(90000)) { throw 'Desktop did not exit in time' }
  $stage = 'verify-after-exit'
  Save-Status 'parent-exited'
  if (Test-Path -LiteralPath $CancelFile) { throw 'Preparation was cancelled' }
  Verify-Installer
  # NSIS /D must be the last argument and consumes the remaining path, including
  # spaces. Preserve the interactive wizard and existing per-user install root.
  $stage = 'launch-installer'
  $setup = Start-Process -FilePath $Installer -ArgumentList @("/D=$InstallDirectory") -PassThru
  $null = $setup.Handle
  Save-Status 'launched'
  $stage = 'installer-exit'
  $setup.WaitForExit()
  if ($setup.ExitCode -ne 0) { throw 'Installer failed or was cancelled' }
  Save-Status 'completed'
} catch {
  try {
    Write-Receipt @{ status = 'error'; token = $Token; pid = $PID; stage = $stage; code = $stage }
  } catch {}
  if ($armed) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show('The update could not be completed. Open AIBanlv and retry the update.', 'AIBanlv update')
  }
  exit 1
} finally {
  if (Test-Path -LiteralPath $CancelFile) { Remove-Item -LiteralPath $CancelFile -ErrorAction SilentlyContinue }
}
