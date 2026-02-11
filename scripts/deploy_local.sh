#!/usr/bin/env bash
set -euo pipefail

# Default services to deploy (core services that back roboard.duckdns.org)
# Can be overridden via SERVICES env var
DEFAULT_SERVICES="edge gateway web-frontend api-backend agent-manager llm-gateway mcp-server"
SERVICES="${SERVICES:-$DEFAULT_SERVICES}"

# Docker compose file path (repo root, NOT deploy/prod/)
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$(realpath "$0")")/../docker-compose.yml}"

echo "================================"
echo "LOCAL DEPLOYMENT (docker compose)"
echo "================================"
echo ""
echo "Compose file: $COMPOSE_FILE"
echo "Services: $SERVICES"
echo ""

# Verify compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE"
  exit 1
fi

# Verify docker compose command exists
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker not found or not accessible"
  exit 1
fi

# Use docker compose if available, otherwise fallback to docker-compose
if docker compose version &> /dev/null 2>&1; then
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
else
  COMPOSE_CMD="docker-compose -f $COMPOSE_FILE"
fi

echo "Using: $COMPOSE_CMD"
echo ""

# Step 1: Validate compose configuration
echo "[1/2] Validating compose configuration..."
if ! $COMPOSE_CMD config -q > /dev/null 2>&1; then
  echo "ERROR: Compose configuration is invalid"
  echo "Run '$COMPOSE_CMD config' for details"
  exit 1
fi
echo "Compose configuration: OK"
echo ""

# Step 2: Build and deploy services
echo "[2/2] Building and deploying services..."
if ! $COMPOSE_CMD up -d --build $SERVICES; then
  echo "ERROR: Deployment failed"
  exit 1
fi

echo ""
echo "================================"
echo "DEPLOYMENT COMPLETE"
echo "================================"
echo ""
echo "Services deployed:"
echo "  $SERVICES"
echo ""
echo "Verification commands:"
echo "  curl -I https://roboard.duckdns.org/"
echo "  curl https://roboard.duckdns.org/api/health"
echo ""
