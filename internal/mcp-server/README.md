# mcp-server

MCP proxy server that forwards search requests to SearXNG.

## Environment Variables

- `SEARXNG_URL`: Base URL of the SearXNG instance (required)
- `INTERNAL_API_KEY`: Internal API key for authentication (required)

## API Endpoint

### POST /search

Forwards search queries to SearXNG and returns results.

**Headers:**
- `X-Internal-Key`: Internal API key (required)

**Request:**
```json
{
  "query": "search terms"
}
```

**Response:**
```json
{
  "results": [
    {
      "title": "Result title",
      "url": "https://example.com",
      "content": "Result snippet"
    }
  ]
}
```

## Notes

This is not a full MCP protocol implementation. It is a simple proxy to SearXNG search functionality.
