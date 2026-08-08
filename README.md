# BATFlow

BATFlow 0.6.0 is a static, client-side visualizer for MS-DOS 7.1 batch logic.
Load BAT and CONFIG.SYS files, inspect the complete 2D control-flow graph, set
simulation inputs inside the relevant blocks, and review the executed source
path. Nothing is uploaded or saved in browser storage.

## Run

Serve `public/` from any static web server:

```sh
python3 -m http.server 8080 --directory public
```

Open `http://localhost:8080`. For Synology Web Station, use `public/` as the
site document root.

## Verify

Node.js 24 is required for development checks.

```sh
npm ci
npx playwright install firefox chromium
npm run check
npm run test:e2e
npm run smoke
```

The app has no runtime dependencies, backend, browser persistence, service
worker, or build step. Sources stay in memory and are never executed. See the
[compatibility boundary](docs/COMPATIBILITY.md) and
[numbered roadmap](docs/ROADMAP.md).
