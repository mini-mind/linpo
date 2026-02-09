#!/usr/bin/env bash
set -euo pipefail

# Environment variables with defaults
# Recommended tag strategy: YYYYMMDD-<git-short-sha>
TAG="${TAG:-$(date +%Y%m%d)-$(git rev-parse --short HEAD)}"
ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-ravin}"

# Image names
PLAYWRIGHT_RUNNER_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-playwright-runner:${TAG}"
PLAYWRIGHT_GATEWAY_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-playwright-gateway:${TAG}"
WORKER_PLAYWRIGHT_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-worker-playwright:${TAG}"
DOCKER_SOCKET_PROXY_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/docker-socket-proxy:0.1.1"

echo "================================"
echo "PUSH WORKER IMAGES TO ACR"
echo "================================"
echo ""
echo "TAG: ${TAG}"
echo "ACR_REGISTRY: ${ACR_REGISTRY}"
echo "ACR_NAMESPACE: ${ACR_NAMESPACE}"
echo ""
echo "Images to push:"
echo "  - ${PLAYWRIGHT_RUNNER_IMAGE}"
echo "  - ${PLAYWRIGHT_GATEWAY_IMAGE}"
echo "  - ${WORKER_PLAYWRIGHT_IMAGE}"
echo "  - ${DOCKER_SOCKET_PROXY_IMAGE}"
echo ""

# Check if docker is logged in (optional, docker login should be done beforehand)
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon not running or not accessible"
  exit 1
fi

# Build and push playwright-runner
echo "[1/4] Building and pushing playwright-runner..."
docker build -t "${PLAYWRIGHT_RUNNER_IMAGE}" ./playwright-runner
docker push "${PLAYWRIGHT_RUNNER_IMAGE}"

# Build and push playwright-gateway
echo "[2/4] Building and pushing playwright-gateway..."
docker build -t "${PLAYWRIGHT_GATEWAY_IMAGE}" ./playwright-gateway
docker push "${PLAYWRIGHT_GATEWAY_IMAGE}"

# Build and push worker-playwright
echo "[3/4] Building and pushing worker-playwright..."
docker build -t "${WORKER_PLAYWRIGHT_IMAGE}" ./worker-playwright
docker push "${WORKER_PLAYWRIGHT_IMAGE}"

# Mirror docker-socket-proxy to ACR
echo "[4/4] Mirroring docker-socket-proxy to ACR..."
docker tag "tecnativa/docker-socket-proxy:0.1.1" "${DOCKER_SOCKET_PROXY_IMAGE}"
docker push "${DOCKER_SOCKET_PROXY_IMAGE}"

echo ""
echo "================================"
echo "PUSH COMPLETE"
echo "================================"
echo ""
echo "All images pushed successfully!"
echo ""

# Print next-step snippet (as comments)
echo "# Next steps on worker host:"
echo "#"
echo "# docker login ${ACR_REGISTRY}"
echo "#"
echo "# Update docker-compose.yml to use ACR images:"
echo "#   services:"
echo "#     worker-playwright:"
echo "#       image: ${WORKER_PLAYWRIGHT_IMAGE}"
echo "#     docker-socket-proxy:"
echo "#       image: ${DOCKER_SOCKET_PROXY_IMAGE}"
echo "#"
echo "# docker compose pull"
echo "# docker compose up -d"
echo ""
