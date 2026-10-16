# NEXUS CONTROL — phase one

NEXUS CONTROL is an English, left-to-right visual demo of a futuristic command center. All readings are simulated in the browser. The existing FastAPI app remains separate from the static interface.

## Static website

Nginx serves `public/index.html` from `/var/www/html/public` on the VPS. The editable style and animation sources are `public/styles.css` and `public/app.js`. A reported production asset response was the same size as `index.html`, indicating an HTML fallback at the asset URL. `public/index.html` embeds both sources so the page does not depend on separate CSS or JavaScript requests.

After changing either source file, regenerate and check the served page:

```bash
python3 scripts/build_public.py
python3 scripts/build_public.py --check
node --check public/app.js
```

Commit the generated `public/index.html` along with the edited source file. This is a buildless static site with no 3D library or runtime dependency. It supports pointer and touch interaction, responsive layouts, and `prefers-reduced-motion`.

For local viewing, open `public/index.html` directly or run:

```bash
python3 -m http.server 8000 --directory public
```

## Deployment verification

An HTTP 200 alone does not prove that an asset was served: an Nginx fallback can return the HTML page at a CSS or JavaScript URL. After updating the VPS, verify the response at `/` against the deployed file:

```bash
curl --fail --silent --show-error --max-time 15 -H 'Accept-Encoding: identity' http://127.0.0.1/ | cmp - public/index.html
```

Keep any Nginx configuration fixes and VPS operations separate from this repository. The original root-level `index.html` remains untouched.

## FastAPI

Python 3.12 is recommended. Install and run the unchanged API from the repository root:

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
| `GET /docs` | Interactive API documentation |

Run the tests with:

```bash
python -m pytest -q
```
