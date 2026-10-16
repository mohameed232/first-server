from pathlib import Path

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

    assert '<html lang="ar" dir="rtl">' in index
    assert "بيانات تجريبية" in index
    assert (PUBLIC_DIR / "styles.css").is_file()
    assert (PUBLIC_DIR / "app.js").is_file()
