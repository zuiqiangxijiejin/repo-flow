"""Check references that can survive a source cleanup without a compiler error."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _prose(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"```.*?```|~~~.*?~~~", "", text, flags=re.S)
    return re.sub(r"`[^`]*`", "", text)


def test_helm_icon_points_to_an_existing_project_asset():
    chart = yaml.safe_load((ROOT / "deploy/helm/deer-flow/Chart.yaml").read_text())
    project = urlsplit(chart["home"]).path.strip("/")
    icon = urlsplit(chart["icon"])
    prefix = f"/{project}/main/"
    assert icon.scheme == "https" and icon.netloc == "raw.githubusercontent.com"
    assert icon.path.startswith(prefix)
    asset = (ROOT / unquote(icon.path.removeprefix(prefix))).resolve()
    assert asset.is_relative_to(ROOT)
    assert asset.is_file(), f"Helm icon references missing project asset: {asset}"


def test_current_guides_have_no_missing_local_file_links():
    pages = set(ROOT.glob("*.md"))
    pages.update((ROOT / "backend").glob("*.md"))
    for directory in ["docs", "backend/docs", "frontend/docs"]:
        pages.update((ROOT / directory).rglob("*.md"))
    pages.update((ROOT / "frontend").glob("*.md"))
    pages.update((ROOT / "examples").glob("*/*.md"))
    pages.update((ROOT / "docker").glob("*/*.md"))
    pages.update((ROOT / "deploy/helm/deer-flow").glob("*.md"))
    missing = []
    for page in sorted(pages):
        for target in re.findall(r"\]\(<?([^\s)>]+)", _prose(page)):
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith(("#", "/", "{")):
                continue
            if not (page.parent / unquote(parsed.path)).exists():
                missing.append(f"{page.relative_to(ROOT)}: {target}")
    assert not missing, "Missing documentation targets:\n" + "\n".join(missing)


def test_localized_documentation_routes_have_content():
    missing = []
    for locale in ["en", "zh"]:
        content = ROOT / "frontend/src/content" / locale
        for page in content.rglob("*.mdx"):
            for route in re.findall(r"(?:\]\(|href=[\"'])/docs/([A-Za-z0-9_/-]+)", _prose(page)):
                route = route.rstrip("/")
                if not (content / f"{route}.mdx").is_file() and not (content / route / "index.mdx").is_file():
                    missing.append(f"{page.relative_to(ROOT)}: /docs/{route}")
    assert not missing, "Missing localized documentation routes:\n" + "\n".join(missing)
