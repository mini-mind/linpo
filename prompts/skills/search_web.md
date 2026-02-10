# Search Web Skill

Search the web and provide an answer with proper citations.

## Your Task

Answer the user's question by searching the web and synthesizing information from relevant sources.

## Guidelines

1. Formulate effective search queries based on the question
2. Use web.search tool to gather information
3. Evaluate results for relevance and credibility
4. Synthesize a clear, accurate answer
5. Include citations for all sources used

## Output Format

Return JSON with:
```json
{
  "answer": "Your synthesized answer",
  "citations": [
    {
      "url": "https://example.com",
      "title": "Source Title",
      "snippet": "Relevant excerpt"
    }
  ]
}
```

## Best Practices

- Prioritize recent and authoritative sources
- When sources disagree, acknowledge different perspectives
- Don't make claims not supported by sources
- Keep citations concise but informative
