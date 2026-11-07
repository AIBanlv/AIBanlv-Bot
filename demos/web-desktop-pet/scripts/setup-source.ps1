param([switch]$SkipInstall, [string]$DesktopDirectory, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$pluginRoot = Join-Path $repositoryRoot 'demos\web-desktop-pet\harness-client-plugin'
if (!$DesktopDirectory) { $DesktopDirectory = [Environment]::GetFolderPath('DesktopDirectory') }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot 'demos\web-desktop-pet\artifacts\local-launch' }

function Invoke-SetupNode([string]$Stage, [string[]]$Arguments) {
    $previousPreference = $ErrorActionPreference
    $global:LASTEXITCODE = 1
    try {
        # PS 5.1 treats redirected native stderr as ErrorRecord objects. npm
        # warnings are not failures; use the exit code and retain both streams.
        $ErrorActionPreference = 'Continue'
        & $node @Arguments 2>&1 | ForEach-Object { Write-Host $_.ToString() }
    } finally { $ErrorActionPreference = $previousPreference }
    if ($LASTEXITCODE -ne 0) { throw "$Stage failed (exit $LASTEXITCODE). See details above." }
}

Push-Location $repositoryRoot
$originalPath = $env:PATH
$logStarted = $false
try {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
    $logDirectory = Join-Path $env:LOCALAPPDATA 'AIBanlv\logs'
    [void][IO.Directory]::CreateDirectory($logDirectory)
    $logPath = Join-Path $logDirectory ('setup-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.log')
    Start-Transcript -LiteralPath $logPath -Force | Out-Null
    $logStarted = $true
    Write-Host "Setup log: $logPath"
    . (Join-Path $pluginRoot 'source-node.ps1')
    $node = Get-AIBanlvSourceNode -Install:(-not $SkipInstall) -RepositoryRoot $repositoryRoot
    foreach ($key in @('NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR')) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
    $env:PATH = (Split-Path -Parent $node) + ';' + $originalPath
    $npm = Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js'
    Write-Host "Using Node: $node"
    if (!$SkipInstall) {
        Invoke-SetupNode 'Source dependency check' @((Join-Path $PSScriptRoot 'check-source-idle.mjs'))
        if (!(Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
            throw 'Git is required for source dependencies and updates. Install Git from https://git-scm.com/download/win, then reopen Setup AIBanlv.cmd.'
        }
        Write-Host 'Installing project dependencies and preparing the local model runtime...'
        Invoke-SetupNode 'Root dependency installation' @($npm, 'ci')
        Invoke-SetupNode 'Dependency/runtime setup' @($npm, 'run', 'setup')
    }
    Invoke-SetupNode 'Source runtime registration' @((Join-Path $pluginRoot 'desktop-launch.mjs'), '--register-source')

    [void][IO.Directory]::CreateDirectory($DesktopDirectory)
    [void][IO.Directory]::CreateDirectory($OutputDirectory)
    $runner = Join-Path $pluginRoot 'run.ps1'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcutPath = Join-Path $DesktopDirectory 'AIBanlv Source.lnk'
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '" -Source'
    $shortcut.WorkingDirectory = $repositoryRoot
    $shortcut.IconLocation = (Join-Path $repositoryRoot 'static\aibanlv.ico') + ',0'
    $shortcut.Description = 'AIBanlv source desktop companion'
    $shortcut.Save()

    $profileDirectory = if ($env:PET_DEVICE_USER_DATA) { $env:PET_DEVICE_USER_DATA } else { Join-Path $env:APPDATA 'Control Device' }
    $mcpPath = Join-Path $OutputDirectory 'workbuddy-mcp.json'
    Copy-Item -LiteralPath (Join-Path $profileDirectory 'desktop-mcp-config.json') -Destination $mcpPath -Force
    Write-Host "Desktop shortcut: $shortcutPath"
    Write-Host "WorkBuddy MCP config: $mcpPath"
    Write-Host "Harness local plugin: $pluginRoot"
    Write-Host 'Codex: add this repository as a local marketplace, install AIBanlv, then review its hooks.'
    if ($SkipInstall) { Write-Host 'Dependency/runtime setup was skipped. Run full setup if this is a new checkout.' }
    else { Write-Host 'Local inference runtime is ready. Double-click AIBanlv Source to start.' }
} catch {
    Write-Host ('AIBanlv setup failed: ' + $_.Exception.Message) -ForegroundColor Red
    if ($logStarted) { Write-Host "Setup log: $logPath" }
    exit 1
} finally {
    if ($logStarted) { Stop-Transcript | Out-Null }
    $env:PATH = $originalPath
    Pop-Location
}
