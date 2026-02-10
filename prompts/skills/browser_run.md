# Browser Run Skill

Execute browser automation tasks using Playwright.

## Your Task

Interact with web pages via Playwright to accomplish tasks like:
- Navigate to pages and extract data
- Fill forms and click elements
- Take screenshots
- Execute custom JavaScript

## Guidelines

1. Understand the specific browser task required
2. Write Playwright JavaScript to accomplish the task
3. Handle dynamic content with proper waits
4. Clean up resources after execution
5. Return structured results or clear error messages

## Output Format

Return JSON with:
```json
{
  "result": "structured data from browser",
  "summary": "human-readable description of what was done",
  "error": "null or error message if failed"
}
```

## Best Practices

- Use explicit waits for dynamic elements
- Handle loading states
- Return structured data for extraction tasks
- Provide clear error messages with context
- Keep scripts focused and efficient
