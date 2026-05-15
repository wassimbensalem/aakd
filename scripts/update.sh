#!/bin/bash
# ClauseFlow — Zero-downtime update script
# Run on your server whenever you want to deploy the latest version.
#
# Usage: bash scripts/update.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "[ClauseFlow] Pulling latest code..."
git pull origin main

echo "[ClauseFlow] Building new images..."
docker compose -f docker-compose.prod.yml --env-file .env.prod build --parallel

echo "[ClauseFlow] Restarting services..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo ""
echo "✓ Update complete"
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
