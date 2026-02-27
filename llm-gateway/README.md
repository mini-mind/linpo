# llm-gateway

Platform-level LLM gateway for internal services, powered by LiteLLM.

## Environment Variables

- `INTERNAL_API_KEY`: internal API key for authentication (required, comma-separated allowed)
- `LLM_PROVIDERS_PATH`: JSON config path for providers (default: `/run/secrets/llm-providers.json`)

## Provider Config

`LLM_PROVIDERS_PATH` must point to a JSON file with the following structure:

```json
{
  "providers": {
    "ark-code-latest": {
      "base_url": "https://example-ark-host/v3",
      "api_key": "YOUR_ARK_API_KEY"
    },
    "right-code/gpt-5.2": {
      "base_url": "https://right.codes/codex/v1",
      "api_key": "YOUR_RIGHT_CODE_API_KEY"
    }
  }
}
```

The gateway accepts any model name that exists as a key in the `providers` map.

## API Endpoints

### GET /health

Returns `{ "status": "ok" }`.

### POST /internal/llm/chat

Requires header `X-Internal-Key: <INTERNAL_API_KEY>`.

Request body:

```json
{
  "model": "ark-code-latest",
  "messages": [
    {"role": "user", "content": "hello"}
  ],
  "temperature": 0.2,
  "max_tokens": 512
}
```

The gateway uses LiteLLM to forward OpenAI-compatible chat requests with the
configured `base_url` and `api_key`.
