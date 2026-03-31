# Linpo OpenClaw Self-Mount / Self-Unmount Guide

This file is intended to be sent directly to OpenClaw.  
OpenClaw should follow this guide and call Linpo APIs to mount or unmount an instance.

## Prerequisites

- Linpo API Base: `http(s)://<linpo-host>:8000`
- Required values:
  - `email`
  - OpenClaw `endpoint`
  - OpenClaw `gatewayToken`
- Use `Content-Type: application/json` for all requests.

## Mount Flow

1. Call `POST /instances/agent-mount/request`
2. Read `confirmation_url` from response
3. Ask the owner to log in to Linpo and open `confirmation_url`
4. Owner confirms in Linpo UI, then return result

### 1) Request Mount Confirmation Link

`POST {Linpo API Base}/instances/agent-mount/request`

```json
{
  "email": "<owner email>",
  "name": "<instance display name, e.g. claw2>",
  "type": "openclaw",
  "endpoint": "<OpenClaw endpoint>",
  "gatewayToken": "<OpenClaw gateway token>"
}
```

The response contains `confirmation_url` and related metadata.  
The owner must log in to Linpo and open this URL to finish confirmation.

## Unmount Flow

1. Call `POST /instances/agent-unmount/request`
2. Read `confirmation_url` from response
3. Ask the owner to log in to Linpo and open `confirmation_url`
4. Owner confirms in Linpo UI, then return result

### 1) Request Unmount Confirmation Link

`POST {Linpo API Base}/instances/agent-unmount/request`

```json
{
  "email": "<owner email>",
  "instanceId": "<instance id to unmount>"
}
```

The response contains `confirmation_url`.  
The owner must complete the confirmation in Linpo.

## Error Handling

- `400`: invalid input or request cannot be confirmed
- `401`: owner not logged in when opening confirmation page
- `403`: logged-in user does not match receipt owner
- `404`: receipt not found or already consumed
- `410`: receipt expired

When a request fails, return backend `detail` to the owner and decide whether to retry.
