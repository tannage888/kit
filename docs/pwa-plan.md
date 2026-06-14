# Kit PWA Implementation Plan

Status: **ON HOLD** — queue when ready to implement.

## Goal

Make Kit accessible from anywhere via a mobile-friendly Progressive Web App served at a public HTTPS URL (e.g. `kit.yourdomain.com`). Users tap "Add to Home Screen" and get an app-like experience without an App Store.

## Prerequisites (must be done first)

These are infrastructure steps, not code changes. Do them before touching the codebase.

### 1. Domain + Cloudflare Tunnel

1. Point a domain (or subdomain) at Cloudflare
2. Install `cloudflared` on the Kit PC and create a tunnel:
   ```
   cloudflared tunnel create kit
   cloudflared tunnel route dns kit kit.yourdomain.com
   ```
3. Add a pm2 entry for `cloudflared tunnel run kit` so it starts with the system
4. The tunnel forwards `kit.yourdomain.com` → `http://localhost:3141`

### 2. Cloudflare Access (authentication)

1. In the Cloudflare dashboard → Access → Applications → Add an application
2. Select "Self-hosted", set domain to `kit.yourdomain.com`
3. Set policy: allow your Google account (didntreadthemanual@gmail.com)
4. This gates every request before it reaches the gateway — zero gateway code changes for auth

### 3. CORS update (gateway)

In `gateway/src/index.ts`, add the public domain to the CORS allowed origins list alongside `localhost:3143`:

```ts
// existing CORS config — add your public domain
origin: ['http://localhost:3143', 'https://kit.yourdomain.com']
```

---

## Phase 1 — PWA manifest and icons

**Files to create/edit:**

- `web/public/manifest.json` — app name, theme colour, display mode, icon references
- `web/public/icons/` — PNG icons at 192×192 and 512×512 (and 180×180 for Apple touch icon)
- `web/index.html` — add `<link rel="manifest">`, Apple meta tags, theme-colour meta

**manifest.json shape:**
```json
{
  "name": "Kit",
  "short_name": "Kit",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**index.html additions:**
```html
<link rel="manifest" href="/manifest.json" />
<link rel="apple-touch-icon" href="/icons/icon-180.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="theme-color" content="#000000" />
```

---

## Phase 2 — Service worker (offline + caching)

Use **vite-plugin-pwa** — it generates the service worker automatically from a config in `vite.config.ts`. No manual service worker code.

```
cd web && npm install -D vite-plugin-pwa
```

`vite.config.ts` addition:
```ts
import { VitePWA } from 'vite-plugin-pwa'

plugins: [
  react(),
  VitePWA({
    registerType: 'autoUpdate',
    workbox: {
      // Cache the app shell and API GET responses
      runtimeCaching: [{
        urlPattern: /^http:\/\/localhost:3141\/api\/.*/,
        handler: 'NetworkFirst',
        options: { cacheName: 'kit-api', networkTimeoutSeconds: 5 }
      }]
    }
  })
]
```

Caching strategy: **NetworkFirst** for API calls (show cached data if offline, refresh when online). App shell is precached automatically.

---

## Phase 3 — Mobile UX audit

Before calling it done, test the existing React UI on a real phone and fix:

- Touch targets — minimum 44×44px for all buttons and interactive elements
- Viewport — ensure `<meta name="viewport" content="width=device-width, initial-scale=1">` is set (likely already is)
- Safe areas — add `padding: env(safe-area-inset-bottom)` to any fixed bottom bars to avoid iPhone home indicator overlap
- Text sizing — no text below 14px on mobile
- Horizontal scroll — nothing should overflow viewport width

---

## Phase 4 — Production build and deploy

```bash
cd web && npm run build   # output to web/dist/
pm2 restart kit-gateway   # gateway serves web/dist/ at /
```

The Vite proxy (`/api` → `:3141`) is dev-only. In production the gateway serves both the static assets and the API from the same origin, so no CORS issues for API calls made from the PWA itself.

---

## Testing checklist

- [ ] Visit `kit.yourdomain.com` in Chrome on Android — "Add to Home Screen" prompt appears
- [ ] Visit in Safari on iPhone — manual "Share → Add to Home Screen" works
- [ ] App opens full-screen (no browser chrome) from home screen icon
- [ ] Cloudflare Access login gate fires on first visit, not again after
- [ ] API calls work from the installed PWA
- [ ] Kill internet connection — app loads from cache, shows last data
- [ ] Lighthouse PWA score ≥ 90

---

## Effort estimate

| Task | Est. |
|---|---|
| Cloudflare Tunnel + Access setup | 1–2 hrs |
| CORS update | 5 min |
| manifest.json + icons + index.html | 1 hr |
| vite-plugin-pwa setup | 1 hr |
| Mobile UX audit + fixes | 1–2 hrs |
| Testing | 1 hr |
| **Total** | **~6–7 hrs** |
