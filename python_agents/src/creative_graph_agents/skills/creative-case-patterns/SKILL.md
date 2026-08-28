---
name: creative-case-patterns
description: Select one or two creative pattern cards as optional few-shot references for first-round or graph-growth ideation. Do not use for factual grounding or final Story convergence.
---

# Creative Case Patterns

Use this skill when a Creative Agent needs a compact structural reference for a Brief or a growth request.

1. Read only the catalog metadata first. Select at most two cards by product category, platform, audience, Hook, desired story mechanism, and complementarity.
2. Load the selected cards from [references/cases.json](references/cases.json).
3. Transfer only abstract mechanisms such as Hook, conflict, structure, selling-point integration, and CTA. Do not copy product names, protagonists, props, wording, or unsupported facts.
4. The user Brief, hard constraints, promotion subject, adopted graph facts, and rejected-content rules always take priority.
5. Treat cards as optional inspiration, never as evidence or already-confirmed story facts.

Do not apply this skill during final Story convergence. That stage must use only adopted graph nodes and edges as its factual source.

Selection output:

```json
{
  "selected_skills": [
    {
      "skill_id": "countdown-challenge",
      "reason": "The Brief needs a fast, visible challenge Hook."
    }
  ]
}
```

Return an empty list when no card materially fits.
