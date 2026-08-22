#!/usr/bin/env bash
# ==============================================================================
# VanailaChat - Automated Setup & Launch Script (Linux / macOS)
# Supports: Debian, Ubuntu, Fedora, RHEL, Arch Linux, Manjaro, openSUSE, Alpine, macOS
# ==============================================================================

set -e

# Color definitions
BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo -e "${BOLD}${CYAN}"
echo "  __     __                  _ _        _____ _           _   "
echo "  \\ \\   / /                 (_) |      / ____| |         | |  "
echo "   \\ \\_/ /_ _ _ __   __ _ _ _| | __ _ | |    | |__   __ _| |_ "
echo "    \\   / _\` | '_ \\ / _\` | | | |/ _\` || |    | '_ \\ / _\` | __|"
echo "     | | (_| | | | | (_| | | | | (_| || |____| | | | (_| | |_ "
echo "     |_|\\__,_|_| |_|\\__,_|_|_|_|\\__,_| \\_____|_| |_|\\__,_|\\__|"
echo -e "${RESET}"
echo -e "${BOLD}Self-Hosted AI Workspace for Local & Cloud Models${RESET}"
echo "--------------------------------------------------------"

# ── 1. Desktop shortcut creation argument check ────────────────────────────────
if [[ "$1" == "--desktop" || "$1" == "-d" ]]; then
  echo -e "${BLUE}ℹ Creating Linux Desktop shortcut...${RESET}"
  DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
  APPS_DIR="$HOME/.local/share/applications"

  ICON_PATH="$APP_DIR/public/favicon.png"
  DESKTOP_ENTRY="[Desktop Entry]
Version=1.0
Type=Application
Name=VanailaChat
Comment=Self-Hosted AI Workspace
Exec=\"$APP_DIR/start.sh\"
Icon=$ICON_PATH
Path=$APP_DIR
Terminal=true
Categories=Development;Office;Utility;
StartupNotify=true"

  if mkdir -p "$APPS_DIR" 2>/dev/null; then
    echo "$DESKTOP_ENTRY" > "$APPS_DIR/vanailachat.desktop" 2>/dev/null || true
    chmod +x "$APPS_DIR/vanailachat.desktop" 2>/dev/null || true
    echo -e "${GREEN}✓ Application menu shortcut created at: $APPS_DIR/vanailachat.desktop${RESET}"
  fi

  if [ -d "$DESKTOP_DIR" ] && [ -w "$DESKTOP_DIR" ]; then
    echo "$DESKTOP_ENTRY" > "$DESKTOP_DIR/vanailachat.desktop" 2>/dev/null || true
    chmod +x "$DESKTOP_DIR/vanailachat.desktop" 2>/dev/null || true
    echo -e "${GREEN}✓ Desktop shortcut created at: $DESKTOP_DIR/vanailachat.desktop${RESET}"
  fi
  echo ""
  exit 0
fi

# ── 2. Distro Detection Helper ────────────────────────────────────────────────
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "$ID"
  elif command -v uname >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
    echo "macos"
  else
    echo "unknown"
  fi
}

DISTRO=$(detect_distro)

# ── 3. Node.js Verification & Installation ────────────────────────────────────
check_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 20 ]; then
      echo -e "${GREEN}✓ Node.js $(node -v) detected.${RESET}"
      return 0
    else
      echo -e "${YELLOW}⚠ Node.js $(node -v) detected, but Node.js 20+ is required.${RESET}"
    fi
  else
    echo -e "${YELLOW}⚠ Node.js is not installed.${RESET}"
  fi

  echo -e "${CYAN}Attempting to guide or install Node.js 20+ for [$DISTRO]...${RESET}"

  case "$DISTRO" in
    ubuntu|debian|pop|mint|elementary)
      echo -e "${BLUE}To install Node.js 20 on Debian/Ubuntu, run:${RESET}"
      echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
      echo "  sudo apt-get install -y nodejs"
      read -p "Would you like to install Node.js 20 now via sudo? [y/N] " -n 1 -r
      echo ""
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
      else
        echo -e "${RED}Please install Node.js 20+ and re-run this script.${RESET}"
        exit 1
      fi
      ;;
    fedora|rhel|centos|rocky|almalinux)
      echo -e "${BLUE}To install Node.js 20 on Fedora/RHEL, run:${RESET}"
      echo "  sudo dnf module install -y nodejs:20/common || sudo dnf install -y nodejs"
      read -p "Would you like to install Node.js now via sudo? [y/N] " -n 1 -r
      echo ""
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo dnf install -y nodejs || sudo dnf module install -y nodejs:20/common
      else
        echo -e "${RED}Please install Node.js 20+ and re-run this script.${RESET}"
        exit 1
      fi
      ;;
    arch|manjaro|endeavouros)
      echo -e "${BLUE}To install Node.js on Arch Linux, run:${RESET}"
      echo "  sudo pacman -S --noconfirm nodejs npm"
      read -p "Would you like to install Node.js now via sudo? [y/N] " -n 1 -r
      echo ""
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo pacman -S --noconfirm nodejs npm
      else
        echo -e "${RED}Please install Node.js 20+ and re-run this script.${RESET}"
        exit 1
      fi
      ;;
    opensuse*|suse)
      echo -e "${BLUE}To install Node.js on openSUSE, run:${RESET}"
      echo "  sudo zypper install -y nodejs20 || sudo zypper install -y nodejs"
      read -p "Would you like to install Node.js now via sudo? [y/N] " -n 1 -r
      echo ""
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo zypper install -y nodejs20 || sudo zypper install -y nodejs
      else
        echo -e "${RED}Please install Node.js 20+ and re-run this script.${RESET}"
        exit 1
      fi
      ;;
    macos)
      if command -v brew >/dev/null 2>&1; then
        echo -e "${BLUE}Installing Node.js via Homebrew...${RESET}"
        brew install node@20 || brew install node
      else
        echo -e "${RED}Please install Node.js 20+ from https://nodejs.org or install Homebrew.${RESET}"
        exit 1
      fi
      ;;
    *)
      echo -e "${RED}Please install Node.js 20+ manually using your distribution's package manager, or via fnm/nvm: https://nodejs.org${RESET}"
      exit 1
      ;;
  esac
}

check_node

# ── 4. Package Manager (pnpm / npm) Setup ─────────────────────────────────────
PACKAGE_MANAGER="pnpm"

if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${YELLOW}ℹ pnpm not found. Setting up pnpm...${RESET}"
  if command -v corepack >/dev/null 2>&1; then
    echo "Enabling corepack..."
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v npm >/dev/null 2>&1; then
      echo "Installing pnpm globally via npm..."
      npm install -g pnpm >/dev/null 2>&1 || true
    fi
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠ Could not install pnpm globally. Will use npx pnpm / npm fallback.${RESET}"
    if npx pnpm -v >/dev/null 2>&1; then
      PACKAGE_MANAGER="npx pnpm"
    else
      PACKAGE_MANAGER="npm"
    fi
  else
    echo -e "${GREEN}✓ pnpm configured successfully (${PACKAGE_MANAGER}).${RESET}"
  fi
else
  echo -e "${GREEN}✓ pnpm detected ($(pnpm -v)).${RESET}"
fi

# ── 5. Environment File Setup ─────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo -e "${BLUE}ℹ Creating .env from .env.example...${RESET}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created.${RESET}"
  else
    touch .env
  fi
fi

# ── 6. Dependency Installation ────────────────────────────────────────────────
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo -e "${CYAN}📦 Installing dependencies with ${PACKAGE_MANAGER}...${RESET}"
  $PACKAGE_MANAGER install
  echo -e "${GREEN}✓ Dependencies up to date.${RESET}"
else
  echo -e "${GREEN}✓ Dependencies already installed.${RESET}"
fi

# ── 7. Check Ollama (Optional) ────────────────────────────────────────────────
if command -v ollama >/dev/null 2>&1; then
  if ! curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo -e "${YELLOW}ℹ Ollama is installed but not running. Starting Ollama in background...${RESET}"
    ollama serve >/dev/null 2>&1 &
    sleep 1
  fi
  echo -e "${GREEN}✓ Ollama local model service is active.${RESET}"
else
  echo -e "${YELLOW}ℹ Ollama not detected. (Cloud providers like OpenRouter/OpenAI/9Router work out of the box).${RESET}"
fi

# ── 8. Browser Auto-Open in Background ────────────────────────────────────────
open_browser_when_ready() {
  local target_url="http://localhost:5173"
  local attempts=0
  local max_attempts=40

  while [ $attempts -lt $max_attempts ]; do
    sleep 0.5
    if curl -s -o /dev/null -w "%{http_code}" "$target_url" 2>/dev/null | grep -q "200"; then
      echo -e "\n${GREEN}🚀 VanailaChat is ready at ${target_url}! Opening in your browser...${RESET}"
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$target_url" >/dev/null 2>&1 || true
      elif command -v open >/dev/null 2>&1; then
        open "$target_url" >/dev/null 2>&1 || true
      elif command -v sensible-browser >/dev/null 2>&1; then
        sensible-browser "$target_url" >/dev/null 2>&1 || true
      fi
      break
    fi
    attempts=$((attempts + 1))
  done
}

open_browser_when_ready &

# ── 9. Start Application ──────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}Starting VanailaChat server & UI...${RESET}"
echo -e "Web App URL: ${CYAN}http://localhost:5173${RESET}"
echo -e "${YELLOW}Press Ctrl+C at any time to stop the server.${RESET}\n"

exec $PACKAGE_MANAGER run dev
