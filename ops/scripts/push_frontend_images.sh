#!/usr/bin/env bash
set -euo pipefail

# Check if git working tree is dirty
if ! git diff --quiet; then
  echo "ERROR: Git working tree is dirty. Please commit or stash your changes before pushing images."
  echo ""
  echo "Uncommitted changes:"
  git status --short
  exit 1
fi

# Environment variables with defaults
# Recommended tag strategy: YYYYMMDD-<git-short-sha>
TAG="${TAG:-$(date +%Y%m%d)-$(git rev-parse --short HEAD)}"
ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-ravin}"

# Image names
WEB_FRONTEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/roboard-web-frontend:${TAG}"
GATEWAY_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/roboard-gateway:${TAG}"

echo "================================"
echo "PUSH FRONTEND IMAGES TO ACR"
echo "================================"
echo ""
echo "TAG: ${TAG}"
echo "ACR_REGISTRY: ${ACR_REGISTRY}"
echo "ACR_NAMESPACE: ${ACR_NAMESPACE}"
echo ""
echo "Images to push:"
echo "  - ${WEB_FRONTEND_IMAGE}"
echo "  - ${GATEWAY_IMAGE}"
echo ""

# Check if docker is logged in (optional, docker login should be done beforehand)
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon not running or not accessible"
  exit 1
fi

# Build and push web-frontend
echo "[1/2] Building and pushing web-frontend..."
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN: docker build -t \"${WEB_FRONTEND_IMAGE}\" ./edge-ui/web-frontend"
  echo "DRY RUN: docker push \"${WEB_FRONTEND_IMAGE}\""
else
  docker build -t "${WEB_FRONTEND_IMAGE}" ./edge-ui/web-frontend
  docker push "${WEB_FRONTEND_IMAGE}"
fi

# Build and push gateway
echo "[2/2] Building and pushing gateway..."
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY RUN: docker build -t \"${GATEWAY_IMAGE}\" ./edge-ui/gateway"
  echo "DRY RUN: docker push \"${GATEWAY_IMAGE}\""
else
  docker build -t "${GATEWAY_IMAGE}" ./edge-ui/gateway
  docker push "${GATEWAY_IMAGE}"
fi

echo ""
echo "================================"
echo "PUSH COMPLETE"
echo "================================"
echo ""
echo "All images pushed successfully!"
echo ""

# Print summary
echo "Summary of pushed images:"
echo "  - ${WEB_FRONTEND_IMAGE}"
echo "  - ${GATEWAY_IMAGE}"
echo ""

# Print next-step snippet (as comments)
echo "# Next steps on frontend host:"
echo "#"
echo "# docker login ${ACR_REGISTRY}"
echo "#"
echo "# Update docker-compose.yml to use ACR images:"
echo "#   services:"
echo "#     web-frontend:"
echo "#       image: ${WEB_FRONTEND_IMAGE}"
echo "#     gateway:"
echo "#       image: ${GATEWAY_IMAGE}"
echo "#"
echo "# docker compose pull"
echo "# docker compose up -d"
echo ""
