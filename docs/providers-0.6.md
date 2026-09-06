# Neo 0.6.0 — Workspace menus and AI providers

Every workspace has an anchored ellipsis menu with Rename workspace, Add collection and Remove empty workspace. Removing a nonempty workspace or the last workspace stays disabled; saved work is preserved. The menu also works on inactive workspaces.

Obsidian settings, deep-link action and URI implementation are removed. Notion and portable Markdown/HTML exports remain.

## AI setup

OpenAI, Claude (Anthropic), Gemini (Google), DeepSeek and Other / OpenAI-compatible are explicit choices. Known providers use fixed official endpoints, avoiding manual URL entry. Changing provider supplies a suggested model, which remains editable; a custom endpoint field appears only for Other. Saved keys are separated by provider, and custom keys by endpoint. Existing credentials migrate once to their original connection; keys remain excluded from backups.

The implementation uses OpenAI/DeepSeek Chat Completions, Claude Messages and Gemini generateContent. Output still passes the existing collection-ID validator and preview/apply flow. No grouping is applied automatically.

Primary API/model references checked on 2026-09-06:

- [OpenAI GPT-5 mini / Chat Completions support](https://developers.openai.com/api/docs/models/gpt-5-mini)
- [Claude Messages](https://platform.claude.com/docs/en/api/messages/create) and [model IDs](https://platform.claude.com/docs/en/models/overview)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [DeepSeek API and model IDs](https://api-docs.deepseek.com/) and [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)

Suggested defaults are gpt-5-mini, claude-sonnet-5, gemini-2.5-flash and deepseek-v4-flash. Model availability depends on provider account access; these are editable defaults, not a live model catalogue.

## Validation

77 unit tests passed, including each provider's request URL, authentication/body/response shape, valid plan output, key migration/separation and backup exclusion. Provider responses were mocked; no paid requests were made with real credentials.

The packaged ZIP was extracted and loaded in isolated Chrome. Eleven core and targeted checks passed without browser exceptions. Workspace tests exercised Add collection, protected nonempty removal, empty removal and per-workspace menus. Provider tests saved all five choices, checked conditional endpoint input, verified key status isolation and absence of Obsidian. Menu and provider screenshots were visually reviewed.

Browser evidence: `output/chrome-1788674549441/results.json`. Unit evidence: `output/unit-0.6.0.txt`. Package checks verified 38 files and the generated overlay.

Reload the existing extension card and refresh its pages; the protocol version changed to prevent stale UI from using the old single-key connection contract.
