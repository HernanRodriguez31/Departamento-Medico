# SECURITY_AUDIT

## Scope
- Scan patterns: serviceAccount*.json, apiKey, private_key, client_email, OPENAI, GEMINI, Bearer, Authorization.
- Goal: identify secrets in repo, document risk, and apply P0 fixes without breaking the site.

## Findings
| Hallazgo | Ubicacion (archivo:linea) | Severidad | Riesgo | Accion concreta |
| --- | --- | --- | --- | --- |
| Service account private key file (Firebase Admin) present as local-only artifact | carga - usuarios/serviceAccountKey.local.json:1 | P0 | Full admin access if leaked (data loss, abuse, cost) | Keep key out of repo, enforce gitignore, load via env path, rotate key and purge history if it was ever committed. |
| Client-side Gemini API key usage (removed; now requires proxy) | asistente-ia/index.html:340 | P0 | Key abuse and unbounded billing if exposed in client | Do not store keys in client. Use a backend proxy and store GEMINI key in server secrets; rotate key. |
| Client-side password gate (insecure by design) | js/app.js:582; js/app-mobile.js:560 | P1 | Bypassable access gate; previously hardcoded secret | Replace with real auth (Firebase Auth) or server-side checks. If still needed, inject config at runtime, not in repo. |
| Firebase client config (apiKey, projectId, etc) in HTML | index.html:2738; app/index.html:2661 | P2 | Not a secret, but can be abused if rules are weak | Keep rules tight (Auth + rules). Treat as public config and monitor. |
| FCM VAPID public key in client | index.html:3545; app/index.html:3470 | P2 | Public key; low risk but usable for messaging token requests | Monitor usage; rotate if abuse is detected. |

## Notes
- OPENAI_API_KEY is referenced only by name in `functions/index.js` and should be managed as a Firebase Functions secret.
