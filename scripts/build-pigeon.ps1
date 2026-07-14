$ErrorActionPreference = 'Stop'

$blender = Get-Command blender -ErrorAction SilentlyContinue
if ($blender) {
  $blenderPath = $blender.Source
} else {
  $blenderPath = 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'
}

if (-not (Test-Path -LiteralPath $blenderPath)) {
  throw 'Blender 5.1 was not found.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot 'tools\blender\build_pigeon.py'
& $blenderPath --background --python $scriptPath
if ($LASTEXITCODE -ne 0) {
  throw "Blender pigeon build failed with exit code $LASTEXITCODE."
}

$blendPath = Join-Path $projectRoot 'assets\blender\pigeon.blend'
$previewScript = Join-Path $projectRoot 'tools\blender\render_pigeon_preview.py'
& $blenderPath --background $blendPath --python $previewScript
if ($LASTEXITCODE -ne 0) {
  throw "Blender pigeon preview failed with exit code $LASTEXITCODE."
}
