# Deployment

BATFlow is a static application. Publish the contents of `dist/` or `public/`
as the complete web root; do not publish the repository root.

## Secure origin

Offline reload requires a secure browser context. Use HTTPS for deployments;
localhost is accepted for development. If the static web server does not
terminate TLS itself, place it behind a TLS-enabled reverse proxy. This applies
equally to Synology-hosted and other conventional web servers.

HTTP deployments outside localhost continue to work online, but Diagnostics
reports the offline shell as unavailable.

## Root and subpath hosting

All runtime URLs, the service-worker scope, and its offline fallback are
relative. The same artifact may therefore be served at a domain root or below
a path such as `/batflow/`. Do not rewrite application requests to the
repository or another origin.

The service-worker script must be served from the same directory as
`index.html`. No broader `Service-Worker-Allowed` scope is required.

## Cache policy

Configure the server or reverse proxy so these entry resources always
revalidate:

```text
/index.html          Cache-Control: no-cache
/service-worker.js   Cache-Control: no-cache
```

The equivalent subpath rules apply when BATFlow is not hosted at `/`. The `/`
document response should also revalidate or resolve to the revalidated
`index.html`.

JavaScript and CSS URLs carrying the managed `?v=` shell revision may be cached
for a long time. Do not apply an immutable rule to `service-worker.js`. Its
registration URL is deliberately stable, and the application forces update
checks to bypass the HTTP cache.

Deploy the complete artifact together. Do not publish a new `index.html`
before its referenced revisioned assets and service-worker shell are present.

## Storage and backup

Projects are stored in origin-scoped IndexedDB. The offline shell uses the
Cache API, but never contains project names, files, notes, or simulation
values. Moving BATFlow to another scheme, host, or port creates a new storage
origin that cannot read the prior deployment. Moving it to another path on the
same origin changes the service-worker scope but continues to share that
origin's BATFlow project database.

BATFlow asks the browser for persistent origin storage once. Browsers may
grant, deny, prompt, or later clear best-effort/private storage according to
their own policies. Regular `.batflow` exports are the durable backup and the
supported method for moving projects between origins.
