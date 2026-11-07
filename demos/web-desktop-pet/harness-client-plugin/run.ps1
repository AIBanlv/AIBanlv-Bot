param([switch]$Automatic, [switch]$Source, [switch]$EnableAutoStart, [switch]$DisableAutoStart)
$ErrorActionPreference = 'Stop'
try {
    $profileDirectory = if ($env:PET_DEVICE_USER_DATA) { $env:PET_DEVICE_USER_DATA } else { Join-Path $env:APPDATA 'Control Device' }
    $runtimeFile = Join-Path $profileDirectory 'desktop-launch-runtime'
    $sourceRuntime = [bool]$Source
    if (!$Source -and (Test-Path -LiteralPath (Join-Path $profileDirectory 'desktop-launch.json'))) {
        $sourceRuntime = ((Get-Content -LiteralPath (Join-Path $profileDirectory 'desktop-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json).kind -eq 'source')
    }
    $runtimeExecutable = if ($sourceRuntime) {
        # Keep the launcher usable if an interrupted npm ci removed Electron.
        . (Join-Path $PSScriptRoot 'source-node.ps1')
        $sourceDemo = if ($Source) { Join-Path $PSScriptRoot '..' } else {
            (Get-Content -LiteralPath (Join-Path $profileDirectory 'desktop-launch.json') -Raw -Encoding UTF8 | ConvertFrom-Json).root
        }
        Get-AIBanlvSourceNode -RepositoryRoot ([IO.Path]::GetFullPath((Join-Path $sourceDemo '..\..')))
    } elseif (Test-Path -LiteralPath $runtimeFile) {
        [IO.File]::ReadAllText($runtimeFile)
    } else { throw 'Open the installed AIBanlv once, or run Setup AIBanlv.cmd first.' }
    if (![IO.Path]::IsPathRooted($runtimeExecutable) -or
        [IO.Path]::GetFileName($runtimeExecutable) -notin @('node.exe', 'electron.exe', 'AIBanlv.exe') -or
        !(Test-Path -LiteralPath $runtimeExecutable -PathType Leaf)) {
        throw 'AIBanlv runtime was moved or is missing. Run Setup AIBanlv.cmd again.'
    }
    if ($sourceRuntime) { $env:PATH = (Split-Path -Parent $runtimeExecutable) + ';' + $env:PATH }
    $scriptFile = Join-Path $PSScriptRoot 'desktop-launch.mjs'
    $launchArguments = @($scriptFile)
    if ($Automatic) { $launchArguments += '--auto' }
    if ($Source) { $launchArguments += '--source' }
    if ($EnableAutoStart) { $launchArguments += '--enable-auto-start' }
    if ($DisableAutoStart) { $launchArguments += '--disable-auto-start' }
    $env:ELECTRON_RUN_AS_NODE = '1'
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    # Piping makes Windows PowerShell wait for the GUI-subsystem Electron binary.
    & $runtimeExecutable @launchArguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'AIBanlv could not start. Run setup again or check the application configuration.' }
} catch {
    if ($Automatic) { [Console]::Error.WriteLine($_.Exception.Message) }
    else {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'AIBanlv')
    }
    exit 1
}
