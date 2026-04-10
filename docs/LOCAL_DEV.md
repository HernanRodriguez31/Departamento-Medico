# Local Development

## A) Recommended (Firebase Emulator)
```bash
cd functions && npm i
export OPENAI_API_KEY=your_key
export GEMINI_API_KEY=your_key
firebase emulators:start --only hosting,functions
```
Open: `http://127.0.0.1:5002/app/index.html`

Use this path for PWA, service workers, push, Functions rewrites and auth flows. The hosting emulator port is defined in `firebase.json`.

## B) Live Server (VS Code)
- Live Server runs on port `5502` in this workspace and is useful for fast visual checks only.
- It auto-reloads when watched files change. Workspace noise such as emulator logs, docs, tests and Functions files is ignored in `.vscode/settings.json` to avoid apparent app "restarts" while evaluating `index.html`.
- `/api/ai` does not exist without Firebase Hosting rewrites.
- Use `?aiEndpoint=https://us-central1-departamento-medico-brisa.cloudfunctions.net/aiChat_v2` only for explicit debugging without Hosting rewrites.
- If you point `?aiEndpoint=` to an `http` emulator from an `https` page, the browser will block it as mixed content.

## Chatbot verification checklist
- Auth token is present: `window.parent.dmGetAuthToken()` resolves to a non-null token.
- Endpoint is resolved: console shows `[AI] endpoint: ...`.
- Request succeeds: Network response status is `200`.
