worker-playwright: Browser automation worker pool service.

Environment Variables:
  MCP_URL - URL to mcp-server for /search endpoint
  INTERNAL_API_KEY - Internal API key for authentication

API Endpoints:
  POST /run
    Headers:
      X-Internal-Key: <INTERNAL_API_KEY>
    Body: JSON object with search parameters (requires input.query)
    Calls mcp-server /search endpoint
    Returns search results