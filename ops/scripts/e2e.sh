#!/usr/bin/env bash
set -euo pipefail

# Environment variables with defaults
export ADMIN_API_KEY=${ADMIN_API_KEY:-admin_test}
export INTERNAL_API_KEY=${INTERNAL_API_KEY:-internal_test}
export SEARXNG_SECRET_KEY=${SEARXNG_SECRET_KEY:-searxng_test}

# Constants
GATEWAY_URL="http://localhost:8082"
API_BACKEND_URL="http://localhost:8000"
MAILHOG_URL="http://localhost:8025"
REQUEST_ID="e2e-trace-1"
TIMEOUT=30

echo "=== Starting E2E Test ==="

# Function to wait for service health
wait_for_service() {
    local url=$1
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -sfS "$url" >/dev/null 2>&1; then
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    echo "ERROR: Service $url not ready after ${max_attempts}s"
    return 1
}

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

# Start services
echo "Starting services..."
$DOCKER_COMPOSE_CMD up -d --build \
    gateway api dispatch worker-playwright \
    mcp-server redis postgres searxng mailhog

# Wait for services to be ready
echo "Waiting for services..."
wait_for_service "${API_BACKEND_URL}/health"
wait_for_service "${GATEWAY_URL}/"

# Create tenant via internal API
echo "Creating tenant..."
TENANT_RESPONSE=$(curl -s -X POST "${API_BACKEND_URL}/internal/tenants" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"name": "e2e-tenant"}')

API_KEY=$(echo "$TENANT_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('api_key', ''))" 2>/dev/null || echo "")
TENANT_ID=$(echo "$TENANT_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('tenant_id', ''))" 2>/dev/null || echo "")

if [ -z "$API_KEY" ] || [ -z "$TENANT_ID" ]; then
    echo "ERROR: Failed to create tenant. Response: $TENANT_RESPONSE"
    exit 1
fi

echo "Tenant ID: $TENANT_ID"
echo "API Key: ${API_KEY:0:8}..."

# Create task via gateway
echo "Creating task..."
TASK_RESPONSE=$(curl -s -X POST "${GATEWAY_URL}/api/tasks" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Request-ID: $REQUEST_ID" \
  -d '{"input": {"query": "example search"}}')

TASK_ID=$(echo "$TASK_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || echo "")

if [ -z "$TASK_ID" ]; then
    echo "ERROR: Failed to create task. Response: $TASK_RESPONSE"
    exit 1
fi

echo "Task ID: $TASK_ID"

echo "Creating run..."
RUN_RESPONSE=$(curl -s -X POST "${GATEWAY_URL}/api/runs" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"input_nl": "ws verification", "input": {}}')

RUN_ID=$(echo "$RUN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('run_id', ''))" 2>/dev/null || echo "")

if [ -z "$RUN_ID" ]; then
    echo "ERROR: Failed to create run. Response: $RUN_RESPONSE"
    exit 1
fi

echo "Run ID: $RUN_ID"

# WebSocket verification using Python
echo "Verifying WebSocket events..."
WS_URL="ws://localhost:8082/ws/runs/${RUN_ID}?api_key=${API_KEY}"
WS_TIMEOUT=20

python3 - "$WS_URL" "$WS_TIMEOUT" <<'PYTHON_SCRIPT'
import sys
import os
import time
import socket
import json
import base64
import hashlib
import urllib.parse

def parse_ws_frame(data):
    """Minimal WebSocket frame parsing"""
    if len(data) < 2:
        return None, b''
    byte1 = data[0]
    byte2 = data[1]
    opcode = byte1 & 0x0F
    masked = (byte2 & 0x80) != 0
    payload_len = byte2 & 0x7F

    offset = 2

    if payload_len == 126:
        if len(data) < offset + 2:
            return None, b''
        payload_len = int.from_bytes(data[offset:offset+2], 'big')
        offset += 2
    elif payload_len == 127:
        if len(data) < offset + 8:
            return None, b''
        payload_len = int.from_bytes(data[offset:offset+8], 'big')
        offset += 8

    masking_key = b''
    if masked:
        if len(data) < offset + 4:
            return None, b''
        masking_key = data[offset:offset+4]
        offset += 4

    if len(data) < offset + payload_len:
        return None, b''

    payload = data[offset:offset+payload_len]

    if masked:
        unmasked = bytearray()
        for i in range(len(payload)):
            unmasked.append(payload[i] ^ masking_key[i % 4])
        payload = bytes(unmasked)

    return opcode, payload

def ws_connect(url):
    """Connect to WebSocket using raw TCP socket"""
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname
    port = parsed.port if parsed.port else 80
    path = parsed.path
    if parsed.query:
        path += '?' + parsed.query

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(5)
    sock.connect((host, port))

    key = base64.b64encode(os.urandom(16)).decode('utf-8').strip()

    handshake = f"GET {path} HTTP/1.1\r\n"
    handshake += f"Host: {host}:{port}\r\n"
    handshake += "Upgrade: websocket\r\n"
    handshake += "Connection: Upgrade\r\n"
    handshake += f"Sec-WebSocket-Key: {key}\r\n"
    handshake += "Sec-WebSocket-Version: 13\r\n"
    handshake += "\r\n"

    sock.send(handshake.encode('utf-8'))

    response = b''
    while b'\r\n\r\n' not in response:
        chunk = sock.recv(1)
        if not chunk:
            raise Exception("Connection closed during handshake")
        response += chunk

    return sock

if __name__ == '__main__':
    ws_url = sys.argv[1]
    timeout = int(sys.argv[2])

    try:
        sock = ws_connect(ws_url)
    except Exception as e:
        print(f"ERROR: WebSocket connection failed: {e}")
        sys.exit(1)

    sock.settimeout(1)

    events_seen = []
    buffer = b''
    start_time = time.time()

    while time.time() - start_time < timeout:
        try:
            data = sock.recv(4096)
            if not data:
                break

            buffer += data

            while len(buffer) >= 2:
                byte2 = buffer[1]
                frame_len = 2
                payload_len = byte2 & 0x7F

                if payload_len == 126:
                    if len(buffer) < 4:
                        break
                    payload_len = int.from_bytes(buffer[2:4], 'big')
                    frame_len = 4
                elif payload_len == 127:
                    if len(buffer) < 10:
                        break
                    payload_len = int.from_bytes(buffer[2:10], 'big')
                    frame_len = 10

                masked = (byte2 & 0x80) != 0
                if masked:
                    frame_len += 4

                total_len = frame_len + payload_len
                if len(buffer) < total_len:
                    break

                frame_data = buffer[:total_len]
                buffer = buffer[total_len:]

                opcode, payload = parse_ws_frame(frame_data)
                if opcode in [1, 2]:
                    try:
                        event = json.loads(payload.decode('utf-8'))
                        event_type = event.get('type', 'unknown')
                        events_seen.append(event_type)
                        print(f"WS Event: {event_type}")
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass

        except socket.timeout:
            continue
        except Exception as e:
            break

    sock.close()

    if not events_seen:
        print("ERROR: No WebSocket events received")
        sys.exit(1)

    first_event = events_seen[0]
    if first_event != 'snapshot':
        print(f"ERROR: First event is not snapshot, got: {first_event}")
        sys.exit(1)

    print(f"WebSocket OK: Events={events_seen}")
PYTHON_SCRIPT

WS_CHECK_RESULT=$?
if [ $WS_CHECK_RESULT -ne 0 ]; then
    echo "ERROR: WebSocket verification failed"
    exit 1
fi

# Poll for task result
echo "Polling for task result..."
POLL_START=$(date +%s)
RESULT_POLL_TIMEOUT=30
RESULT_FOUND=0

while [ $(($(date +%s) - POLL_START)) -lt $RESULT_POLL_TIMEOUT ]; do
    RESULT_RESPONSE=$(curl -s "${GATEWAY_URL}/api/tasks/${TASK_ID}/result" \
        -H "X-API-Key: $API_KEY")

    SUMMARY=$(echo "$RESULT_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print('has_summary' if d.get('summary') else 'no_summary')" 2>/dev/null || echo "no_summary")

    if [ "$SUMMARY" = "has_summary" ]; then
        RESULT_FOUND=1
        break
    fi

    sleep 2
done

if [ $RESULT_FOUND -eq 0 ]; then
    echo "ERROR: Task result not available within timeout"
    exit 1
fi

echo "Task result OK"

# Verify notifications
echo "Verifying notifications..."
NOTIFICATIONS_RESPONSE=$(curl -s "${GATEWAY_URL}/api/tasks/${TASK_ID}/notifications" \
    -H "X-API-Key: $API_KEY")

HAS_WEB=$(echo "$NOTIFICATIONS_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print('yes' if any(n.get('channel') == 'web' and n.get('status') == 'delivered' for n in d) else 'no')" 2>/dev/null || echo "no")

if [ "$HAS_WEB" != "yes" ]; then
    echo "ERROR: Web notification not delivered. Response: $NOTIFICATIONS_RESPONSE"
    exit 1
fi

HAS_EMAIL=$(echo "$NOTIFICATIONS_RESPONSE" | python3 -c "import sys, json; d=json.load(sys.stdin); print('yes' if any(n.get('channel') == 'email' and n.get('status') == 'delivered' for n in d) else 'no')" 2>/dev/null || echo "no")

if [ "$HAS_EMAIL" != "yes" ]; then
    echo "ERROR: Email notification not delivered. Response: $NOTIFICATIONS_RESPONSE"
    exit 1
fi

echo "Notifications OK"

# Retry/dead-letter verification
echo "=== Testing Retry/Dead-Letter ==="

# Stop worker-playwright
echo "Stopping worker-playwright..."
$DOCKER_COMPOSE_CMD stop worker-playwright

# Get initial dead-letter count
INITIAL_DEAD_COUNT=$($DOCKER_COMPOSE_CMD exec -T redis redis-cli XLEN queue:dispatch:dead 2>/dev/null || echo "0")

# Create another task that should fail and go to dead-letter
echo "Creating task (should fail)..."
TASK2_RESPONSE=$(curl -s -X POST "${GATEWAY_URL}/api/tasks" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"input": {"query": "dead-letter test"}}')

TASK2_ID=$(echo "$TASK2_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || echo "")

if [ -z "$TASK2_ID" ]; then
    echo "ERROR: Failed to create task 2"
    $DOCKER_COMPOSE_CMD start worker-playwright
    exit 1
fi

echo "Task 2 ID: $TASK2_ID"

echo "Waiting for dispatch retries..."
sleep 25

# Check dead-letter queue
DEAD_COUNT=$($DOCKER_COMPOSE_CMD exec -T redis redis-cli XLEN queue:dispatch:dead 2>/dev/null || echo "0")

echo "Dead-letter count: $DEAD_COUNT (initial: $INITIAL_DEAD_COUNT)"

# Give more time if still zero (might need additional retry cycles)
if [ "$DEAD_COUNT" = "0" ]; then
    echo "Dead-letter still empty, waiting longer..."
    sleep 20
    DEAD_COUNT=$($DOCKER_COMPOSE_CMD exec -T redis redis-cli XLEN queue:dispatch:dead 2>/dev/null || echo "0")
    echo "Dead-letter count after extra wait: $DEAD_COUNT"
fi

# We expect at least 1 new entry in dead-letter queue
DEAD_INCREASE=$((DEAD_COUNT - INITIAL_DEAD_COUNT))

if [ $DEAD_INCREASE -lt 1 ]; then
    echo "ERROR: Dead-letter queue did not increase (expected >=1, got $DEAD_INCREASE)"
    $DOCKER_COMPOSE_CMD start worker-playwright
    exit 1
fi

echo "Dead-letter OK (increased by $DEAD_INCREASE)"

# Restart worker-playwright
echo "Restarting worker-playwright..."
$DOCKER_COMPOSE_CMD start worker-playwright

# Wait for worker to be ready
sleep 5

echo "=== E2E OK ==="
