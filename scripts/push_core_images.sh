#!/usr/bin/env bash
set -euo pipefail

# Environment variables with defaults
# Recommended tag strategy: YYYYMMDD-<git-short-sha>
TAG="${TAG:-$(date +%Y%m%d)-$(git rev-parse --short HEAD)}"
# Append '-dirty' if there are uncommitted changes
if ! git diff --quiet; then
  TAG="${TAG}-dirty"
fi
ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
ACR_NAMESPACE="${ACR_NAMESPACE:-ravin}"

# Image names
WEB_FRONTEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-web-frontend:${TAG}"
GATEWAY_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-gateway:${TAG}"
API_BACKEND_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-api-backend:${TAG}"
AGENT_MANAGER_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-agent-manager:${TAG}"
WORKER_PLAYWRIGHT_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-worker-playwright:${TAG}"
MCP_SERVER_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-mcp-server:${TAG}"
LLM_GATEWAY_IMAGE="${ACR_REGISTRY}/${ACR_NAMESPACE}/web3d-llm-gateway:${TAG}"

echo "================================"
echo "PUSH CORE IMAGES TO ACR"
echo "================================"
echo ""
echo "TAG: ${TAG}"
echo "ACR_REGISTRY: ${ACR_REGISTRY}"
echo "ACR_NAMESPACE: ${ACR_NAMESPACE}"
echo ""
echo "Images to push:"
echo "  - ${WEB_FRONTEND_IMAGE}"
echo "  - ${GATEWAY_IMAGE}"
echo "  - ${API_BACKEND_IMAGE}"
echo "  - ${AGENT_MANAGER_IMAGE}"
echo "  - ${WORKER_PLAYWRIGHT_IMAGE}"
echo "  - ${MCP_SERVER_IMAGE}"
echo "  - ${LLM_GATEWAY_IMAGE}"
echo ""

# Check if docker is logged in (optional, docker login should be done beforehand)
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon not running or not accessible"
  exit 1
fi

# Build and push web-frontend
echo "[1/7] Building and pushing web-frontend..."
docker build -t "${WEB_FRONTEND_IMAGE}" ./web-frontend
docker push "${WEB_FRONTEND_IMAGE}"

# Build and push gateway
echo "[2/7] Building and pushing gateway..."
docker build -t "${GATEWAY_IMAGE}" ./gateway
docker push "${GATEWAY_IMAGE}"

# Build and push api-backend
echo "[3/7] Building and pushing api-backend..."
docker build -t "${API_BACKEND_IMAGE}" ./api-backend
docker push "${API_BACKEND_IMAGE}"

# Build and push agent-manager
echo "[4/7] Building and pushing agent-manager..."
docker build -t "${AGENT_MANAGER_IMAGE}" ./agent-manager
docker push "${AGENT_MANAGER_IMAGE}"

# Build and push worker-playwright
echo "[5/7] Building and pushing worker-playwright..."
docker build -t "${WORKER_PLAYWRIGHT_IMAGE}" ./worker-playwright
docker push "${WORKER_PLAYWRIGHT_IMAGE}"

# Build and push mcp-server
echo "[6/7] Building and pushing mcp-server..."
docker build -t "${MCP_SERVER_IMAGE}" ./mcp-server
docker push "${MCP_SERVER_IMAGE}"

# Build and push llm-gateway
echo "[7/7] Building and pushing llm-gateway..."
docker build -t "${LLM_GATEWAY_IMAGE}" ./llm-gateway
docker push "${LLM_GATEWAY_IMAGE}"

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
echo "  - ${API_BACKEND_IMAGE}"
echo "  - ${AGENT_MANAGER_IMAGE}"
echo "  - ${WORKER_PLAYWRIGHT_IMAGE}"
echo "  - ${MCP_SERVER_IMAGE}"
echo "  - ${LLM_GATEWAY_IMAGE}"
echo ""

# Print next-step snippet (as comments)
echo "# Next steps on core host:"
echo "#"
echo "# docker login ${ACR_REGISTRY}"
echo "#"
echo "# Update docker-compose.yml to use ACR images:"
echo "#   services:"
echo "#     web-frontend:"
echo "#       image: ${WEB_FRONTEND_IMAGE}"
echo "#     gateway:"
echo "#       image: ${GATEWAY_IMAGE}"
echo "#     api-backend:"
echo "#       image: ${API_BACKEND_IMAGE}"
echo "#     agent-manager:"
echo "#       image: ${AGENT_MANAGER_IMAGE}"
echo "#     worker-playwright:"
echo "#       image: ${WORKER_PLAYWRIGHT_IMAGE}"
echo "#     mcp-server:"
echo "#       image: ${MCP_SERVER_IMAGE}"
echo "#     llm-gateway:"
echo "#       image: ${LLM_GATEWAY_IMAGE}"
echo "#"
echo "# docker compose pull"
echo "# docker compose up -d"
echo ""
