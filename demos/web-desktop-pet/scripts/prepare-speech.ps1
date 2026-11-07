param(
    [string]$Python = "",
    [string]$Source = ""
)
$ErrorActionPreference = "Stop"
$demo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$workspace = [IO.Path]::GetFullPath((Join-Path $demo "../../.."))
if (!$Python) { $Python = Join-Path $workspace ".venv-lam-coreml/Scripts/python.exe" }
if (!$Source) { $Source = Join-Path $workspace "LAM_Audio2Expression-main/LAM_Audio2Expression-main" }
if (!(Test-Path -LiteralPath $Python)) { throw "Python environment not found: $Python" }
$assets = Join-Path $demo "assets"
New-Item -ItemType Directory -Path $assets -Force | Out-Null
$lines = Get-Content -LiteralPath (Join-Path $PSScriptRoot "speech-lines.json") -Encoding UTF8 -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice.SelectVoice("Microsoft David Desktop")
    $voice.Rate = 0
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
        16000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $voice.SetOutputToWaveFile((Join-Path $assets "phrase-$i.wav"), $format)
        $voice.Speak($lines[$i].text)
        $voice.SetOutputToNull()
    }
} finally {
    $voice.Dispose()
}
& $Python (Join-Path $PSScriptRoot "infer_speech.py") --source $Source --assets $assets
if ($LASTEXITCODE -ne 0) { throw "Original checkpoint inference failed" }
& node (Join-Path $PSScriptRoot "prepare-control.mjs")
if ($LASTEXITCODE -ne 0) { throw "Control postprocessing failed" }
