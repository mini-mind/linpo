agent-manager: Orchestrates agents/jobs and multi-tenant limits.

Environment Variables:
- WORKER_URL: URL of the worker service
- API_BACKEND_URL: URL of the API backend
- INTERNAL_API_KEY: Internal API key for authentication
- LLM_GATEWAY_URL: URL of the LLM gateway service
- DISPATCH_STREAM: Redis stream for dispatch jobs
- DISPATCH_DEAD_STREAM: Dead-letter stream for dispatch jobs
- DISPATCH_GROUP: Redis consumer group for dispatch
- DISPATCH_CONSUMER: Redis consumer name for dispatch
- DISPATCH_MAX_ATTEMPTS: Max retry attempts for dispatch jobs

Endpoints:
POST /internal/dispatch
  Receives dispatch requests and forwards them to workers.
  Posts task events to api-backend at /api/tasks/{id}/events
  Requires X-Internal-Key header with INTERNAL_API_KEY value

Dispatch stream payload (queue:dispatch):
{
  "task_id": "string",
  "tenant_id": "string",
  "input_json": "{\"input_nl\":...,\"input\":...}",
  "attempt": "1",
  "enqueued_at": "2026-02-27T00:00:00Z",
  "trace_id": "optional-trace-id"
}

Request Example:
{
  "task_id": "string",
  "tenant_id": 12345,
  "input": {}
}

Response Example:
{
  "status": "dispatched",
  "task_id": "string"
}
