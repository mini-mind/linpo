#!/bin/bash
set -euo pipefail

WORKER_HOST="${WORKER_HOST:-175.178.213.10}"
WORKER_USER="${WORKER_USER:-ubuntu}"
REMOTE_DIR="${REMOTE_DIR:-~/web3d-worker}"
TAG="${TAG:-latest}"

if [ -z "${INTERNAL_API_KEY:-}" ]; then
  echo "Error: INTERNAL_API_KEY environment variable is not set"
  echo "Please run: INTERNAL_API_KEY=your-secret-key ./scripts/deploy_worker.sh"
  exit 1
fi

LOCAL_COMPOSE_FILE="deploy/worker/docker-compose.yml"

echo "Creating remote directory on ${WORKER_USER}@${WORKER_HOST}:${REMOTE_DIR}..."
ssh "${WORKER_USER}@${WORKER_HOST}" "mkdir -p ${REMOTE_DIR}"

echo "Copying compose file to remote..."
scp "${LOCAL_COMPOSE_FILE}" "${WORKER_USER}@${WORKER_HOST}:${REMOTE_DIR}/docker-compose.yml"

echo "Pre-pulling Playwright runner image on worker host..."
# Pre-pull the runner image because the playwright-gateway container cannot supply 
# ACR credentials to the Docker Engine when it attempts to pull the image via Docker API.
# Pulling it on the host first ensures the image is available locally.
ssh "${WORKER_USER}@${WORKER_HOST}" "docker pull registry.cn-hangzhou.aliyuncs.com/ravin/web3d-playwright-runner:${TAG}"

echo "Deploying worker stack..."
ssh "${WORKER_USER}@${WORKER_HOST}" "cd ${REMOTE_DIR} && TAG=${TAG} INTERNAL_API_KEY=${INTERNAL_API_KEY} docker compose up -d"

echo "Deployment complete"
