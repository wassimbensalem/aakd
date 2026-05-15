#!/bin/bash
# Set DocuSeal API key after first deploy.
# Run after logging into sign.yourdomain.com and copying the API key.
#
# Usage: bash scripts/set-docuseal-key.sh YOUR_DOCUSEAL_API_KEY

set -euo pipefail

KEY="${1:-}"
if [ -z "$KEY" ]; then
  echo "Usage: bash scripts/set-docuseal-key.sh YOUR_DOCUSEAL_API_KEY"
  echo ""
  echo "Get your key from: https://sign.yourdomain.com → Settings → API"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env.prod not found. Run deploy.sh first."
  exit 1
fi

# Update DOCUSEAL_API_KEY in .env.prod
sed -i "s|^DOCUSEAL_API_KEY=.*|DOCUSEAL_API_KEY=${KEY}|" "$ENV_FILE"
echo "✓ DOCUSEAL_API_KEY updated in .env.prod"

# Restart app and worker to pick up the new key
cd "$REPO_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod restart app worker
echo "✓ App and worker restarted"
echo ""
echo "E-signatures are now enabled."
