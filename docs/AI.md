# AI

## Endpoint
- `POST /api/ai` (Hosting rewrite to `functions.aiChat`)

## Auth
- Requires a Firebase ID token in `Authorization: Bearer <token>`.
- The assistant iframe uses `window.parent.dmGetAuthToken()` when embedded.

## Request
```json
{
  "provider": "openai | gemini",
  "prompt": "text for openai (optional if using contents)",
  "contents": "gemini contents array (optional)",
  "model": "gemini model id (optional)",
  "fallbackModel": "gemini fallback model id (optional)"
}
```

## Response
```json
{ "ok": true, "text": "..." }
```
```json
{ "ok": false, "error": "..." }
```

## Secrets
- `OPENAI_API_KEY` (Functions secret)
- `GEMINI_API_KEY` (Functions secret)

Set secrets:
```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
```

Deploy Functions:
```bash
firebase deploy --only functions
```

## Notes
- All keys live server-side only. No API keys in the client.
- Basic in-memory rate limit per UID (see `AI_RATE_LIMIT_*` in `functions/index.js`).
- Logs include uid, provider, timestamp, and status.
