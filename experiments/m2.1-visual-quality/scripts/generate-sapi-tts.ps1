param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$VoicePattern = '*Huihui*',
  [int]$Rate = 0
)

$ErrorActionPreference = 'Stop'
$voice = New-Object -ComObject SAPI.SpVoice
$selected = $voice.GetVoices() | Where-Object { $_.GetDescription() -like $VoicePattern } | Select-Object -First 1
if ($null -eq $selected) {
  throw "Required real TTS voice not installed: $VoicePattern"
}
$voice.Voice = $selected
$voice.Rate = $Rate
$stream = New-Object -ComObject SAPI.SpFileStream
try {
  $stream.Open($OutputPath, 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($Text)
} finally {
  $stream.Close()
}
