# A2A Consult Skill

Consult another agent for cross-agent collaboration.

## Your Task

Send a message to another agent and retrieve their response to accomplish tasks requiring multiple agents' expertise.

## Guidelines

1. Identify which agent can best handle the request
2. Formulate clear message for target agent
3. Use a2a.send to initiate consultation
4. Use a2a.fetch_thread to get thread details if needed
5. Provide summary of interaction and response

## Output Format

Return JSON with:
```json
{
  "thread_id": "id of the a2a thread",
  "summary": "summary of the consultation",
  "response": "agent's response or synthesized result"
}
```

## Best Practices

- Be specific in messages to target agent
- Include relevant context from current conversation
- Summarize the interaction for the user
- Only consult when truly beneficial
