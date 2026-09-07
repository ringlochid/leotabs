# AI model defaults, 2026-09-07

| Provider | Default | Lowest reasoning setting used |
| --- | --- | --- |
| Google | gemini-3.8-flash | generationConfig.thinkingConfig.thinkingLevel: low |
| DeepSeek | deepseek-v4-flash | thinking.type: disabled |
| Anthropic | claude-sonnet-5 | thinking.type: disabled |
| OpenAI | gpt-5.6-luna | reasoning_effort: none |

The shared askJSON request path applies these controls to naming, collection AI and topic grouping. Unknown custom models receive no new model-specific fields. Previous shipped Gemini 2.5 Flash and GPT-5 mini defaults upgrade once; other model choices and later explicit overrides are preserved. The provider dropdown uses this same default registry. Existing legacy fast GPT-5 requests retain their supported minimal/low-verbosity settings.

Official sources checked:
- https://ai.google.dev/gemini-api/docs/latest-model (3.8 Flash supports low/medium/high; minimal is rejected)
- https://ai.google.dev/api/generate-content (GenerateContent thinkingConfig schema)
- https://api-docs.deepseek.com/guides/thinking_mode/ (V4 Flash thinking defaults to enabled; explicitly disabled here)
- https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5 (Sonnet 5 adaptive thinking defaults on; disabled is supported)
- https://developers.openai.com/api/docs/models/gpt-5.6-luna (exact requested model; none is supported)
- https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6 (Chat Completions reasoning_effort)

Validation: 163 unit tests passed, including all four production request payloads, default migration and custom-model isolation. Isolated Chrome check output/chrome-1788788915807 verified the actual AI connection provider dropdown, save and reload. No paid/live provider calls were made. Overlay and ZIP rebuilt; 63 packaged files pass syntax, asset, ZIP integrity and source-byte checks.
