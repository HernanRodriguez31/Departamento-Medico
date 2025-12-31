# SECRETS

## What secrets exist
- Firebase Admin service account key (used by `carga - usuarios/subir_medicos.js`).
- OpenAI API key for Functions (`OPENAI_API_KEY`).
- Gemini API key (was used in client; now removed and should only exist server-side if re-enabled).
- Optional runtime login password (if the client-side modal is still required). Do not store it in source.

## Where secrets must live
- Service account key: stored outside the repo. Provide its path via `SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` when running `subir_medicos.js`.
- OpenAI API key: stored as a Firebase Functions secret (`OPENAI_API_KEY`).
- Gemini API key: store server-side only (future backend proxy). Do not expose in HTML/JS.
- Optional login password: inject at runtime (e.g., via a script tag that sets `window.__LOGIN_PASSWORD__`) and never commit it.

## Never commit
- Any `serviceAccountKey*.json` file.
- API keys or bearer tokens in HTML/JS.
- Private keys, client_email values, or full Firebase Admin JSON contents.
- Local env files containing secrets unless explicitly meant to be committed (do not add .env with real keys).

## Manual rotation checklist
1) Firebase service account key
   - Create a new key in GCP IAM.
   - Update local path used by `SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS`.
   - Disable and delete the old key.
   - If the old key was ever committed, purge it from git history.
2) OpenAI API key
   - Rotate the key in OpenAI.
   - Update Firebase Functions secret `OPENAI_API_KEY`.
   - Redeploy Functions.
3) Gemini API key (if re-enabled)
   - Rotate in Google AI Studio.
   - Store only in a backend proxy secret (do not expose to clients).
   - Update proxy configuration and redeploy.
4) Client login password (if used)
   - Rotate the injected value (not in repo).
   - Verify the modal still works for intended users.
