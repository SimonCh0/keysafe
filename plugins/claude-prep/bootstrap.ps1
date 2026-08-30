# bootstrap — install the tools Claude needs, on Windows.
#
# PowerShell on purpose: node is one of the things this installs, so the installer
# cannot be a node script. PowerShell ships with Windows.
#
#   powershell -File bootstrap.ps1            report only
#   powershell -File bootstrap.ps1 -Install   install what is missing
#
# winget handles elevation itself, so this usually needs no password.

param([switch]$Install)

function Have($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

Write-Output ""
Write-Output "Platform: Windows"
Write-Output ""

$needNode = -not (Have node)
$needGit  = -not (Have git)
$needPy   = -not ((Have python) -or (Have uv))

Write-Output ("node    " + $(if ($needNode) { "MISSING" } else { "ok" }))
Write-Output ("git     " + $(if ($needGit)  { "MISSING" } else { "ok" }))
Write-Output ("python  " + $(if ($needPy)   { "MISSING" } else { "ok" }))
Write-Output ""

if (-not ($needNode -or $needGit -or $needPy)) {
  Write-Output "Everything is already installed. Nothing to do."
  exit 0
}

if (-not $Install) {
  Write-Output "Nothing changed. Run with -Install to fix the above."
  exit 0
}

if (-not (Have winget)) {
  Write-Output "winget is missing, which means an older Windows build."
  Write-Output "Download these by hand instead:"
  Write-Output "  Node    https://nodejs.org/en/download"
  Write-Output "  Git     https://git-scm.com/download/win"
  exit 1
}

if ($needNode) {
  Write-Output "Installing Node..."
  winget install --silent --accept-source-agreements --accept-package-agreements OpenJS.NodeJS.LTS
  Write-Output "  Done."
  Write-Output ""
}

if ($needGit) {
  Write-Output "Installing Git..."
  winget install --silent --accept-source-agreements --accept-package-agreements Git.Git
  Write-Output "  Done."
  Write-Output ""
}

if ($needPy) {
  Write-Output "Installing Python..."
  winget install --silent --accept-source-agreements --accept-package-agreements astral-sh.uv
  Write-Output "  Done."
  Write-Output ""
}

Write-Output "Now quit Claude and open it again. Newly installed tools are not visible"
Write-Output "to a session that was already running, so it will look like nothing happened"
Write-Output "until you restart."
