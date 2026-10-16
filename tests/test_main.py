from pathlib import Path
import subprocess
import sys

from fastapi.routing import APIRoute

from main import app

PUBLIC_DIR = Path(__file__).parent.parent / "public"


def get_route(path: str) -> APIRoute:
    return next(
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path == path
    )


def test_welcome():
    route = get_route("/")
    assert "GET" in route.methods
    assert route.endpoint() == {"message": "مرحبًا بك في أول تطبيق FastAPI!"}


def test_health():
    route = get_route("/health")
    assert "GET" in route.methods
    assert route.endpoint() == {"status": "ok"}


def test_public_interface_assets_are_present():
    index = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")

    assert '<html lang="en" dir="ltr">' in index
    assert "Demo Data" in index
    assert (PUBLIC_DIR / "styles.css").is_file()
    assert (PUBLIC_DIR / "app.js").is_file()
    assert '<link rel="stylesheet"' not in index
    assert '<script src=' not in index
    assert index.index("/* NEXUS_CSS_START */") < index.index("</head>")
    assert index.index("</main>") < index.index("// NEXUS_JS_START") < index.index("</body>")


def test_embedded_assets_match_sources():
    check = subprocess.run(
        [sys.executable, "scripts/build_public.py", "--check"],
        cwd=PUBLIC_DIR.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    assert check.returncode == 0, check.stderr
