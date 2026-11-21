"""
Streamlit host for Sole Room.

Streamlit can't serve a multi-file website directly (its static server only
serves images/JSON with real content types), so this wrapper:
  1. serves images + the catalogue from ./static via `enableStaticServing`
     (they become /app/static/...), and
  2. inlines index.html + CSS + JS into one document rendered full-screen.

Run locally:   streamlit run streamlit_app.py
Deploy:        push this repo and point Streamlit Community Cloud at streamlit_app.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

SITE = Path(__file__).parent / "static"
ASSET_BASE = "/app/static/"

st.set_page_config(page_title="Sole Room", page_icon="👟", layout="wide", initial_sidebar_state="collapsed")

# Make the component iframe fill the whole window and hide Streamlit chrome.
st.markdown(
    """
    <style>
      header, footer, [data-testid="stToolbar"], [data-testid="stDecoration"],
      [data-testid="stStatusWidget"], #MainMenu { display: none !important; }
      .stApp, .main, .block-container, [data-testid="stAppViewBlockContainer"] {
        padding: 0 !important; margin: 0 !important; max-width: 100% !important;
      }
      [data-testid="stVerticalBlock"] { gap: 0 !important; }
      iframe { position: fixed; inset: 0; width: 100vw !important; height: 100vh !important; height: 100dvh !important; border: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)


def site_version() -> str:
    """Changes whenever any inlined file changes, so a redeploy never serves stale HTML."""
    files = [SITE / "index.html", SITE / "css" / "style.css", SITE / "data" / "products.json", *sorted((SITE / "js").glob("*.js"))]
    return "|".join(f"{f.name}:{f.stat().st_mtime_ns}:{f.stat().st_size}" for f in files)


@st.cache_data(show_spinner=False)
def build_page(version: str) -> str:
    html = (SITE / "index.html").read_text(encoding="utf-8")

    # inline stylesheet
    css = (SITE / "css" / "style.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="css/style.css" />', f"<style>{css}</style>")

    html = html.replace('<script src="data/products.js"></script>', "")

    # inline module scripts, in order
    def inline_script(m: re.Match) -> str:
        src = m.group(1)
        code = (SITE / src).read_text(encoding="utf-8").replace("</script", "<\\/script")
        return f'<script type="module">\n{code}\n</script>'

    html = re.sub(r'<script type="module" src="([^"]+)"></script>', inline_script, html)

    # ship the catalogue inline and point asset URLs at Streamlit's static server
    products = json.loads((SITE / "data" / "products.json").read_text(encoding="utf-8"))
    data = json.dumps(products, ensure_ascii=False).replace("</", "<\\/")
    # Streamlit Community Cloud serves the app under "/~/+/", so static files
    # live at "/~/+/app/static/..." there and at "/app/static/..." locally.
    # Work out the prefix from the Streamlit page that hosts this iframe.
    boot = (
        "<script>"
        "(function () {"
        "  var path = '/';"
        "  try { path = window.parent.location.pathname; } catch (e) {"
        "    try { path = new URL(document.referrer).pathname; } catch (e2) {} }"
        "  var m = path.match(/^.*?\\/~\\/\\+\\//);"
        f"  window.__ASSET_BASE__ = (m ? m[0] : '/') + {json.dumps(ASSET_BASE.lstrip('/'))};"
        "})();"
        f"window.__PRODUCTS__ = {data};"
        "</script>"
    )
    return html.replace("</head>", boot + "</head>", 1)


components.html(build_page(site_version()), height=900, scrolling=False)
