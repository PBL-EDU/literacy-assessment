param(
  [Parameter(Mandatory = $true)]
  [string]$VaultPath
)

$source = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $source 'main.js'))) {
  throw "Build output not found. Run: npm install; npm run build"
}

$vault = (Resolve-Path -LiteralPath $VaultPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $vault '.obsidian'))) {
  throw "Not an Obsidian vault (missing .obsidian): $vault"
}

$dest = Join-Path $vault '.obsidian\plugins\literacy-assessment'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'main.js'), (Join-Path $source 'manifest.json'), (Join-Path $source 'styles.css'), (Join-Path $source 'LICENSE') -Destination $dest -Force

Write-Host "Installed to: $dest"
Write-Host "Open Obsidian -> Settings -> Community plugins -> enable 'Literacy Assessment'."
Write-Host "If restricted mode is on, turn it off first."
