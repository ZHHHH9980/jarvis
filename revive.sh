#!/bin/bash
set -e

GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}✓${NC} $1"; }

echo "=== Jarvis Revival ==="
echo ""

# 1. Install basics
if ! command -v node &>/dev/null; then
  info "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v git &>/dev/null; then
  apt-get install -y git
fi

if ! command -v tmux &>/dev/null; then
  apt-get install -y tmux
fi

# 2. Clone Jarvis
JARVIS_DIR="$HOME/jarvis"
if [ -d "$JARVIS_DIR" ]; then
  info "Jarvis directory exists, pulling latest..."
  cd "$JARVIS_DIR" && git pull origin main
else
  info "Cloning Jarvis..."
  git clone https://github.com/ZHHHH9980/jarvis.git "$JARVIS_DIR"
fi
cd "$JARVIS_DIR"

# 3. Collect secrets
echo ""
echo "Enter your secrets (press Enter to skip optional ones):"
read -p "Telegram Bot Token: " TG_BOT_TOKEN
read -p "Telegram Chat ID: " TG_CHAT_ID
read -p "Anthropic API Key: " ANTHROPIC_API_KEY
read -p "API Base URL [https://api.anthropic.com]: " API_BASE_URL
API_BASE_URL=${API_BASE_URL:-https://api.anthropic.com}
read -p "Notion Token (optional): " NOTION_TOKEN

# 4. Generate .env
cat > .env << EOF
TG_BOT_TOKEN=$TG_BOT_TOKEN
TG_CHAT_ID=$TG_CHAT_ID
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
API_BASE_URL=$API_BASE_URL
NOTION_TOKEN=$NOTION_TOKEN
PORT=3001
SCAN_DIR=$HOME/projects
SCAN_INTERVAL_MS=3600000
EOF
info "Generated .env"

# 5. Install deps + start
npm install
npx pm2 start src/index.js --name jarvis
npx pm2 save
info "Jarvis started with pm2"

# 6. Install claude-workflow
WORKFLOW_DIR="$HOME/claude-workflow"
if [ ! -d "$WORKFLOW_DIR" ]; then
  git clone https://github.com/ZHHHH9980/claude-workflow.git "$WORKFLOW_DIR"
  "$WORKFLOW_DIR/install.sh"
  info "claude-workflow installed"
fi

echo ""
info "Jarvis is alive!"
echo "  API: http://localhost:3001"
echo "  Telegram: bot is listening"
echo ""
echo "  Next: install Claude Code CLI and run 'claude login'"
