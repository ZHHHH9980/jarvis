#!/bin/bash
set -e
SERVER="root@43.138.129.193"
REMOTE_DIR="/root/jarvis"

echo "Deploying Jarvis..."
rsync -avz --exclude node_modules --exclude .env --exclude data --exclude '*.db' \
  ~/Documents/jarvis/ $SERVER:$REMOTE_DIR/

ssh $SERVER "cd $REMOTE_DIR && npm install && npx pm2 restart jarvis || npx pm2 start src/index.js --name jarvis && npx pm2 save"

echo "✅ Deployed"
