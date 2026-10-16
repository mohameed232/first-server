"""Embed the static assets in the page served by the VPS's Nginx root."""

import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
INDEX = PUBLIC / "index.html"


def embed(page: str, source: str, start: str, end: str) -> str:
    if page.count(start) != 1 or page.count(end) != 1:
        raise ValueError(f"Expected one pair of markers: {start}, {end}")
    before, remainder = page.split(start, 1)
    _, after = remainder.split(end, 1)
    return f"{before}{start}\n{source.rstrip()}\n{end}{after}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if embedded assets are stale")
    args = parser.parse_args()

    page = INDEX.read_text(encoding="utf-8")
    css = (PUBLIC / "styles.css").read_text(encoding="utf-8")
    js = (PUBLIC / "app.js").read_text(encoding="utf-8")
    if "</style" in css.lower() or "</script" in js.lower():
        raise ValueError("An asset contains an HTML closing tag and cannot be embedded")

    generated = embed(page, css, "/* NEXUS_CSS_START */", "/* NEXUS_CSS_END */")
    generated = embed(generated, js, "// NEXUS_JS_START", "// NEXUS_JS_END")
    if args.check:
        if page != generated:
            parser.error("public/index.html is stale; run python3 scripts/build_public.py")
        print("Embedded assets are current")
        return 0

    if page != generated:
        INDEX.write_text(generated, encoding="utf-8")
    print("public/index.html is current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
