# Local Development

## A) Recommended (Firebase Emulator)
```bash
cd functions && npm i
export OPENAI_API_KEY=your_key
export GEMINI_API_KEY=your_key
firebase emulators:start --only hosting,functions
```
Open: `http://127.0.0.1:5000/app/index.html`

## B) Live Server (VS Code)
- `/api/ai` does not exist without Firebase Hosting rewrites.
- Use `?ai=prod` to call the production Function, or rely on the automatic fallback.
- If you use `?ai=emu` from an `https` page, the browser will block `http` (mixed content).

## Chatbot verification checklist
- Auth token is present: `window.parent.dmGetAuthToken()` resolves to a non-null token.
- Endpoint is resolved: console shows `[AI] endpoint: ...`.
- Request succeeds: Network response status is `200`.
