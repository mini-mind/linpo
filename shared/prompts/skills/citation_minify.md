# Citation Minify Skill

Minify and deduplicate citations.

## Your Task

Process a list of citations, removing duplicates and keeping only essential information.

## Guidelines

1. Identify duplicate citations (same URL or title)
2. Keep only unique entries
3. Trim long snippets to essential information
4. Return clean, deduplicated list

## Output Format

Return JSON with:
```json
{
  "minified_citations": [
    {
      "url": "https://example.com",
      "title": "Source Title"
    }
  ]
}
```

## Best Practices

- Prioritize URL uniqueness
- Keep titles readable but concise
- Remove redundant information
- Maintain order of first occurrence
