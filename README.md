# NEXUS CONTROL — phase two

An English, left-to-right command center with read-only **live Linux monitoring**. The existing Canvas energy orb, interactions, responsive layout and reduced-motion support are preserved. No server management actions or new dependencies are introduced.

## Monitoring contract

`GET /api/metrics` returns JSON with only these fields:

```json
{
  "cpu_percent": 25.5,
  "memory": {"percent": 75.0, "used_bytes": 3221225472, "total_bytes": 4294967296},
  "disk": {"percent": 50.0, "used_bytes": 21474836480, "total_bytes": 42949672960},
  "uptime_seconds": 90061.0,
  "timestamp": "2026-10-16T12:00:00Z"
}
```

These example numbers are not production measurements.

- CPU: aggregate `/proc/stat` counter deltas, idle including I/O wait; guest ticks are not double-counted. The first request takes a nonblocking 100 ms sample; subsequent samples cover the interval between reads. Requests share a one-second cache and an async lock per worker.
- RAM: `MemTotal - MemAvailable` from `/proc/meminfo`; Linux reclaimable cache is treated as available memory. Byte counts use 1024 bytes per Linux `kB`.
- Disk: `shutil.disk_usage("/")`, the root filesystem, not a sum of mounted disks. Percent is used / total, including the effect of filesystem reserved space.
- Uptime: `/proc/uptime`; timestamp: UTC server time. Measurements describe the Linux host/filesystem visible to FastAPI (a container may expose different scopes).
- Responses use `Cache-Control: no-store`. Unavailable/invalid readings return a generic HTTP 503 without host details. Only GET is supported.

The hidden-schema alias `GET /metrics` supports existing Nginx proxies that strip `/api/` when forwarding. Both routes return the same restricted data. No configuration changes are required for either prefix-preserving or prefix-stripping proxies.

### Frontend behavior

The browser fetches same-origin `/api/metrics` immediately, then five seconds after each completed request. A four-second timeout covers headers and body. It validates numeric ranges, capacities, JSON content type and timestamps before showing **LIVE**. Browser/server clocks must be within 60 seconds; stale/future responses are rejected.

On failure the status is **OFFLINE**, numeric readings and chart history are cleared, and polling retries automatically. There are no simulated CPU/RAM/disk/uptime fallbacks. Hidden tabs cancel pending requests and stop polling; visibility restores an immediate fresh request. Pausing decorative motion does not stop monitoring. CPU/RAM charts retain up to 60 real samples (roughly five minutes, sample-indexed); uptime and last-server-sample time update only on successful responses.

The energy-core value and secondary network/power/signal gauges remain explicitly labelled **DEMO** decorations, not measured server metrics.

### Security

**The endpoint is public and unauthenticated: anyone who can access it can observe aggregate server utilization and uptime.** A future authentication/access-control layer is recommended before wider or sensitive use. Same-origin fetching is not authentication. HTTPS and rate limiting should also be considered in a separately approved infrastructure phase; this change does not configure them.

The endpoint reads aggregate OS counters only. It exposes no credentials, environment variables, hostname, IP addresses, process lists or commands. No shell execution or management actions are available. No firewall, SSH, Nginx or systemd configuration is changed.

## Static website

Nginx serves `public/index.html` from `/var/www/html/public` on the VPS. Editable sources are `public/styles.css`, `public/monitoring.js` (validation/polling) and `public/app.js` (visuals/rendering). A reported production asset response was the same size as `index.html`, indicating an HTML fallback at the asset URL. The PR #3 fix is preserved: `public/index.html` embeds all sources so the page does not depend on separate CSS or JavaScript requests.

After changing source files, regenerate and check the served page:

```bash
python3 scripts/build_public.py
python3 scripts/build_public.py --check
node --check public/app.js
node --check public/monitoring.js
```

Commit the generated `public/index.html` along with the edited sources. There is no bundler, npm runtime dependency or 3D library. Pointer/touch interaction, responsive layouts, and `prefers-reduced-motion` remain supported.

For local viewing in OFFLINE mode, open `public/index.html` directly or run:

```bash
python3 -m http.server 8000 --directory public
```

A plain static server does not implement `/api/metrics`. Live readings require the existing same-origin `/api/` proxy to FastAPI.

## Deployment after review and merge only

Do not deploy the feature branch automatically. On the VPS, use latest approved `main`, require a clean worktree, and create a private backup of the current tracked release before fast-forwarding. If local changes exist, stop and preserve/review them; do not reset or overwrite them. Dependencies are unchanged; no package installation is necessary for this update.

Check embedded consistency, then restart the existing **`first-server.service`** once to load the backend code. Do not rename the service, change its configuration, or create a new one. Nginx does not need a reload because its configuration is unchanged.

An HTTP 200 alone does not prove that an asset was served: an Nginx fallback can return the HTML page at a CSS or JavaScript URL. After updating the VPS, verify the response at `/` against the deployed file:

```bash
curl --fail --silent --show-error --max-time 15 -H 'Host: 8.213.86.128' -H 'Accept-Encoding: identity' http://127.0.0.1/ | cmp - public/index.html
curl --fail --silent --show-error --max-time 10 -H 'Host: 8.213.86.128' http://127.0.0.1/api/metrics
```

The second command must return the documented JSON with current UTC time, not HTML. Then open the production page and confirm LIVE. If metrics fail, the dashboard remains available in OFFLINE mode; inspect existing service logs/proxy before any infrastructure changes. Keep the backup for manual rollback review. The original root-level `index.html` remains untouched.

## FastAPI

Python 3.12 is recommended. Linux with readable `/proc` is needed for real metrics. Install existing dependencies and run from the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

| Route | Response |
| --- | --- |
| `GET /` | `{"message": "مرحبًا بك في أول تطبيق FastAPI!"}` |
| `GET /health` | `{"status": "ok"}` |
| `GET /api/metrics` | Read-only aggregate Linux utilization |
| `GET /docs` | Interactive API documentation |

Run the tests with:

```bash
python -m pytest -q
node --test tests/monitoring.test.cjs
node --check public/app.js
node --check public/monitoring.js
python scripts/build_public.py --check
python -m compileall -q main.py metrics.py scripts/build_public.py
```

Backend tests use fixture counters and in-process ASGI requests, covering calculations, caching/concurrency, errors, allowed methods, exact response fields, and both proxy paths. Frontend tests use Node's built-in runner (Node 20+; no npm install): valid/invalid data, HTML fallbacks, network errors, stalled bodies, timeouts, recovery, visibility cancellation, and dashboard rendering with reduced motion. Original route and embedded-asset consistency tests remain in place.
