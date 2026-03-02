#!/usr/bin/env bash
set -euo pipefail

# Determine docker compose command
DOCKER_COMPOSE_CMD=""
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo "ERROR: Neither 'docker compose' nor 'docker-compose' found"
    exit 1
fi

# Default services for local deployment
SERVICES="edge gateway web-frontend api dispatch llm-gateway mcp-server skill-gateway sandbox-template redis postgres"

# Build the docker compose command
CMD="$DOCKER_COMPOSE_CMD up -d --build $SERVICES"

# Check for dry run
if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "$CMD"
    exit 0
fi

# Execute the command
echo "Starting services: $SERVICES"
exec $CMD
