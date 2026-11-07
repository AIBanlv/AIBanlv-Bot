# Windows PowerShell 5.1; this helper never modifies the system PATH or nvm.
function Save-AIBanlvNodeArchive {
    param([string]$Uri, [string]$File, [long]$Bytes, [int]$TimeoutSeconds = 180)
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object Net.Http.HttpClient
    try {
        # The small Node ZIP is bounded in memory; HttpClient's deadline covers
        # the entire body, including a server that keeps sending tiny fragments.
        $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
        $client.MaxResponseContentBufferSize = $Bytes
        $data = $client.GetByteArrayAsync($Uri).GetAwaiter().GetResult()
        if ($data.LongLength -ne $Bytes) { throw 'Node archive size mismatch. Retry Setup.' }
        [IO.File]::WriteAllBytes($File, $data)
    } finally { $client.Dispose() }
}

function Get-AIBanlvNodeOutput {
    param([string]$Node, [string]$Arguments)
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Node; $start.Arguments = $Arguments
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    foreach ($key in @('NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR')) { $start.EnvironmentVariables.Remove($key) }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(10000)) { $process.Kill(); return $null }
        if ($process.ExitCode -ne 0) { return $null }
        return $stdout.GetAwaiter().GetResult().Trim()
    } finally { $process.Dispose() }
}

function Test-AIBanlvSourceNode {
    param([string]$Node, [string]$RepositoryRoot)
    try {
        if (!$Node -or ![IO.Path]::IsPathRooted($Node) -or !(Test-Path -LiteralPath $Node -PathType Leaf)) { return $false }
        $info = Get-AIBanlvNodeOutput $Node '-p "JSON.stringify({file:require(''fs'').realpathSync(process.execPath),major:Number(process.versions.node.split(''.'')[0]),arch:process.arch})"' | ConvertFrom-Json -ErrorAction Stop
        if (!$info -or $info.major -lt 24 -or $info.arch -ne 'x64') { return $false }
        if ($RepositoryRoot) {
            $prefix = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\') + '\'
            if ([IO.Path]::GetFullPath($Node).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
                $info.file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $false }
        }
        $npm = Join-Path (Split-Path -Parent $Node) 'node_modules\npm\bin\npm-cli.js'
        if (!(Test-Path -LiteralPath $npm -PathType Leaf)) { return $false }
        $version = Get-AIBanlvNodeOutput $Node ('"' + $npm + '" --version')
        return ($version -match '^\d+\.\d+\.\d+$')
    } catch { return $false }
}

function Get-AIBanlvSourceNode {
    param([switch]$Install, [string]$RepositoryRoot, [string]$CacheDirectory,
        [string[]]$Candidates, [string]$Archive)
    if (!$CacheDirectory) { $CacheDirectory = Join-Path $env:LOCALAPPDATA 'AIBanlv\tools' }
    $CacheDirectory = [IO.Path]::GetFullPath($CacheDirectory)
    $registration = Join-Path $CacheDirectory 'source-node.json'
    if (!$PSBoundParameters.ContainsKey('Candidates')) {
        $Candidates = @(Get-Command node -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    }
    try { $registered = (Get-Content -LiteralPath $registration -Raw -Encoding UTF8 | ConvertFrom-Json).node } catch { $registered = $null }
    $requirement = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source-node.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $name = 'node-v' + $requirement.version + '-win-x64'
    $destination = Join-Path $CacheDirectory $name
    $selected = $null
    foreach ($candidate in @($registered) + $Candidates + @(Join-Path $destination 'node.exe')) {
        if (Test-AIBanlvSourceNode $candidate $RepositoryRoot) { $selected = $candidate; break }
    }
    if (!$Install) {
        if ($selected) { return $selected }
        throw 'Node.js 24+ with npm is not ready. Run Setup AIBanlv.cmd to prepare it automatically.'
    }
    [void][IO.Directory]::CreateDirectory($CacheDirectory)
    $lock = $null; $temporary = $null
    try {
        $deadline = [DateTime]::UtcNow.AddMinutes(10)
        do {
            try { $lock = [IO.File]::Open((Join-Path $CacheDirectory 'source-node.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
            catch [IO.IOException] {
                if ([DateTime]::UtcNow -ge $deadline) { throw 'Another Node setup is still running. Retry Setup later.' }
                Start-Sleep -Milliseconds 500
            }
        } until ($lock)
        if (!$selected -and (Test-AIBanlvSourceNode (Join-Path $destination 'node.exe') $RepositoryRoot)) { $selected = Join-Path $destination 'node.exe' }
        if (!$selected) {
            if (![Environment]::Is64BitOperatingSystem) { throw 'AIBanlv requires 64-bit Windows.' }
            if ($requirement.version -notmatch '^24\.\d+\.\d+$' -or $requirement.sha256 -notmatch '^[a-f0-9]{64}$' -or
                $requirement.url -ne "https://nodejs.org/dist/v$($requirement.version)/$name.zip" -or
                $requirement.mirrorUrl -ne "https://npmmirror.com/mirrors/node/v$($requirement.version)/$name.zip") { throw 'Invalid Node download manifest.' }
            $temporary = Join-Path $CacheDirectory ('.node-prepare-' + [Guid]::NewGuid().ToString('N'))
            [void][IO.Directory]::CreateDirectory($temporary)
            $zip = Join-Path $temporary 'node.zip'
            if ($Archive) { Copy-Item -LiteralPath $Archive -Destination $zip }
            else {
                Write-Host "Preparing AIBanlv Node.js $($requirement.version) (about 36 MiB); your system Node stays unchanged."
                [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
                try { Save-AIBanlvNodeArchive -Uri $requirement.url -File $zip -Bytes $requirement.bytes }
                catch {
                    Write-Host 'The official download did not finish. Trying the fallback mirror with the same pinned SHA-256...'
                    Save-AIBanlvNodeArchive -Uri $requirement.mirrorUrl -File $zip -Bytes $requirement.bytes
                }
            }
            if ((Get-Item -LiteralPath $zip).Length -ne $requirement.bytes) { throw 'Node archive size mismatch. Retry Setup.' }
            $hasher = [Security.Cryptography.SHA256]::Create(); $inputFile = [IO.File]::OpenRead($zip)
            try { $digest = [BitConverter]::ToString($hasher.ComputeHash($inputFile)).Replace('-', '').ToLowerInvariant() }
            finally { $inputFile.Dispose(); $hasher.Dispose() }
            if ($digest -ne $requirement.sha256) { throw 'Node archive SHA-256 mismatch. Retry Setup.' }
            Write-Host 'Node download verified; extracting and checking Node/npm...'
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Compression.ZipFile]::ExtractToDirectory($zip, $temporary)
            $payload = Join-Path $temporary $name
            if (!(Test-AIBanlvSourceNode (Join-Path $payload 'node.exe') $RepositoryRoot)) { throw 'Downloaded Node/npm could not run. Retry Setup.' }
            if (Test-Path -LiteralPath $destination) {
                # Preserve a damaged cache for diagnosis; never replace a running valid runtime.
                Move-Item -LiteralPath $destination -Destination ($destination + '.invalid-' + [Guid]::NewGuid().ToString('N'))
            }
            Move-Item -LiteralPath $payload -Destination $destination
            $selected = Join-Path $destination 'node.exe'
        }
        $pending = Join-Path $CacheDirectory ('source-node-' + [Guid]::NewGuid().ToString('N') + '.json')
        [IO.File]::WriteAllText($pending, (@{node=$selected} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $pending -Destination $registration -Force
        return $selected
    } finally {
        if ($temporary -and $temporary.StartsWith($CacheDirectory.TrimEnd('\') + '\.node-prepare-', [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
        }
        if ($lock) { $lock.Dispose() }
    }
}
