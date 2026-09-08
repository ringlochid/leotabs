# AI organisation response handling

The supplied 5.4-second recording ends with “AI returned an unknown or excluded link.” That message comes from mapping the model's compact numeric IDs back to the collection. The raw provider response is not present in the recording, so the exact malformed value in that run cannot be determined.

A deterministic reproduction returned valid known IDs as JSON strings (`"1"`, `"2"`). The previous `Number.isInteger` check rejected them and produced the same error. Three new regression tests failed before the repair and passed afterward. [MDN documents that numeric strings fail this check](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger).

The parser now accepts exact positive decimal strings only after validating their numeric value against the original groupable IDs. It does not guess offsets, renumber sparse selections, coerce booleans, accept unknown/excluded IDs, or silently discard invalid assignments.

Malformed JSON or invalid grouping output receives at most one correction request to the same provider with the original metadata and explicit eligible IDs. Successful first responses still use one request. HTTP/network failures and cancellation are not retried. If correction fails, no plan is applied. This can add one provider request to an otherwise failing operation. Existing collection fingerprint checks, atomic mutation, and Undo remain in place.

Validation uses mocked provider responses without sending personal metadata or spending API credits. Cases cover numeric strings, unknown/excluded/duplicate IDs, sparse eligible selections, all links excluded, invalid JSON, HTTP 401, cancellation, and edits made before applying a returned plan.
