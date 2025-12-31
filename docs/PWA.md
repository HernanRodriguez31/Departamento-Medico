# PWA Service Workers

## Scopes
- Root scope (`/`): `service-worker.js` controls the marketing/root pages.
- App scope (`/app/`): `app/service-worker.js` controls the app shell and in-app assets.

## Cache namespaces
- Root SW: `brisa-root-*`
- App SW: `brisa-app-*`

Each SW only deletes caches with its own prefix to avoid impacting other scopes.

## Offline strategy
### Root SW
- Precaches: `/`, `/index.html`, `/offline.html`, core CSS and JS for the root page.
- Navigation requests use network-first with fallback to `/offline.html`.
- Static assets under `/assets/`, `/css/`, `/js/` use cache-first.

### App SW
- Precaches: `/app/index.html`, `/offline.html`, app CSS and JS.
- App navigations (`/app/*`) use network-first with fallback to cached shell or `/offline.html`.
- Static assets under `/assets/` use cache-first.

## Notes
- No Workbox or build tooling required; all logic is vanilla SW.
- Bump the cache version in each SW when you need to invalidate old cached assets.
