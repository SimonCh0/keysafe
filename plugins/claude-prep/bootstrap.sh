#!/bin/sh
# bootstrap — install the tools Claude needs, on macOS or Linux.
#
# Written in plain sh on purpose: node is one of the things this installs, so the
# installer cannot be a node script. curl and sh are on every Mac.
#
#   sh bootstrap.sh            report only, changes nothing
#   sh bootstrap.sh --install  install what is missing
#
# Node and Python go into the user's home folder and need no password.
# Git on macOS opens Apple's own dialog, which the user has to click.

INSTALL=0
[ "$1" = "--install" ] && INSTALL=1

have() { command -v "$1" >/dev/null 2>&1; }
say()  { printf '%s\n' "$1"; }

OS="$(uname -s)"
say ""
say "Platform: $OS"
say ""

NEED_NODE=0; NEED_GIT=0; NEED_PY=0
have node || NEED_NODE=1
have git  || NEED_GIT=1
have uv   || have python3 || NEED_PY=1

# On macOS both /usr/bin/git and /usr/bin/python3 exist as stubs before the developer
# tools are installed. They are on PATH but do not work, so `command -v` says yes and
# running them pops Apple's installer. xcode-select is the only way to tell without
# triggering that dialog.
if [ "$OS" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
  NEED_GIT=1
  have uv || NEED_PY=1        # /usr/bin/python3 is a stub too
fi

say "node    $( [ $NEED_NODE -eq 1 ] && echo 'MISSING' || echo "ok  $(node --version 2>/dev/null)" )"
say "git     $( [ $NEED_GIT  -eq 1 ] && echo 'MISSING' || echo "ok  $(git --version 2>/dev/null | cut -d' ' -f3)" )"
say "python  $( [ $NEED_PY   -eq 1 ] && echo 'MISSING' || echo 'ok' )"
say ""

if [ $NEED_NODE -eq 0 ] && [ $NEED_GIT -eq 0 ] && [ $NEED_PY -eq 0 ]; then
  say "Everything is already installed. Nothing to do."
  exit 0
fi

if [ $INSTALL -eq 0 ]; then
  say "Nothing changed. Run with --install to fix the above."
  exit 0
fi

# ── node, via fnm: installs into the home folder, no password ────────────────
if [ $NEED_NODE -eq 1 ]; then
  say "Installing Node. This goes in your home folder and needs no password."
  if have brew; then
    brew install fnm >/dev/null 2>&1
  else
    curl -fsSL https://fnm.vercel.app/install | bash >/dev/null 2>&1
  fi
  # fnm puts itself in one of these depending on how it installed
  for d in "$HOME/.local/share/fnm" "$HOME/.fnm" "/opt/homebrew/bin" "/usr/local/bin"; do
    [ -x "$d/fnm" ] && PATH="$d:$PATH" && export PATH
  done
  if have fnm; then
    eval "$(fnm env 2>/dev/null)" 2>/dev/null
    fnm install --lts >/dev/null 2>&1 && fnm default lts-latest >/dev/null 2>&1
    say "  Node installed."
  else
    say "  Could not install Node automatically."
    say "  Open https://nodejs.org/en/download and run the macOS installer instead."
    say "  That one asks for your Mac password, which is normal."
  fi
  say ""
fi

# ── python, via uv: also home folder, also no password ───────────────────────
if [ $NEED_PY -eq 1 ]; then
  say "Installing Python. Also home folder, also no password."
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1
  PATH="$HOME/.local/bin:$PATH"; export PATH
  if have uv; then
    uv python install >/dev/null 2>&1
    say "  Python installed."
  else
    say "  Could not install Python automatically. It is only needed for some projects,"
    say "  so this is safe to skip for now."
  fi
  say ""
fi

# ── git: the one that needs a click ──────────────────────────────────────────
if [ $NEED_GIT -eq 1 ]; then
  if [ "$OS" = "Darwin" ]; then
    say "Git needs Apple's developer tools."
    say ""
    say "  A grey box will appear in a moment. Click Install and wait a few minutes."
    say "  It is macOS asking, not Claude. Nothing else is needed from you."
    say ""
    xcode-select --install 2>/dev/null
    say "  Tell me once the box has finished and I will check it worked."
  else
    say "Install git with your package manager, e.g. sudo apt install git"
  fi
  say ""
fi

say "Now quit Claude and open it again. Newly installed tools are not visible"
say "to a session that was already running, so it will look like nothing happened"
say "until you restart."
