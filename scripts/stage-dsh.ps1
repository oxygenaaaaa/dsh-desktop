# Stage the dsh package (with its full node_modules) into build/payload/dsh.
#
# electron-builder's extraResources copy unconditionally drops the *root*
# node_modules of the copied source (util/filter.js: `relative === "node_modules"
# => false`). Wrapping the package in a parent dir makes it a *sub* node_modules,
# which is kept. This script must run before every build (`npm run dist` does it).
$ErrorActionPreference = "Stop"
$src = "D:\DSH\node_modules\@deepseek-ai\dsh"
$dst = Join-Path $PSScriptRoot "..\build\payload\dsh"

if (Test-Path (Split-Path $dst -Parent)) {
  Remove-Item (Split-Path $dst -Parent) -Recurse -Force
}
New-Item -ItemType Directory -Force $dst | Out-Null
robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) {
  Write-Error "robocopy failed with exit code $LASTEXITCODE"
  exit 1
}
$size = (Get-ChildItem (Split-Path $dst -Parent) -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("staged dsh payload: {0:N0} MB" -f ($size / 1MB))
exit 0
