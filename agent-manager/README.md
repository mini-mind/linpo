agent-manager: Orchestrates agents/jobs and multi-tenant limits.

Environment Variables:
- WORKER_URL: URL of the worker service
- API_BACKEND_URL: URL of the API backend
- INTERNAL_API_KEY: Internal API key for authentication

Endpoints:
POST /internal/dispatch
  Receives dispatch requests and forwards them to workers.
  Posts task events to api-backend at /api/tasks/{id}/events
  Requires X-Internal-Key header with INTERNAL_API_KEY value

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
