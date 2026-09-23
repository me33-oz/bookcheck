import json
import logging
import os
import re
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

load_dotenv()

logger = logging.getLogger("bookcheck")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "").strip()

GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_URL = "https://openlibrary.org"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent"

app = FastAPI(title="BookCheck")

CACHE_TTL_SECONDS = 6 * 3600
CACHE_MISS = object()
_cache: dict[str, tuple[float, object]] = {}


def cache_get(key: str):
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return CACHE_MISS


def cache_set(key: str, value: object):
    _cache[key] = (time.time() + CACHE_TTL_SECONDS, value)


def normalize_volume(item: dict) -> dict:
    info = item.get("volumeInfo", {})
    sale = item.get("saleInfo", {})
    identifiers = info.get("industryIdentifiers", [])
    isbn13 = next((i["identifier"] for i in identifiers if i["type"] == "ISBN_13"), None)
    isbn10 = next((i["identifier"] for i in identifiers if i["type"] == "ISBN_10"), None)

    price = None
    list_price = sale.get("listPrice")
    if list_price:
        price = {"amount": list_price.get("amount"), "currency": list_price.get("currencyCode")}

    return {
        "googleId": item.get("id"),
        "title": info.get("title"),
        "authors": info.get("authors", []),
        "description": info.get("description"),
        "categories": info.get("categories", []),
        "thumbnail": info.get("imageLinks", {}).get("thumbnail"),
        "isbn13": isbn13,
        "isbn10": isbn10,
        "googleRating": info.get("averageRating"),
        "googleRatingsCount": info.get("ratingsCount"),
        "price": price,
        "infoLink": info.get("infoLink"),
    }


async def google_books_request(params: dict, url: str = GOOGLE_BOOKS_URL) -> dict:
    cache_key = f"books:{url}:{sorted(params.items())}"
    cached = cache_get(cache_key)
    if cached is not CACHE_MISS:
        return cached

    request_params = {**params, "key": GOOGLE_BOOKS_API_KEY} if GOOGLE_BOOKS_API_KEY else params
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params=request_params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        logger.warning("Google Books API Fehler: HTTP %s - %s", e.response.status_code, e.response.text[:300])
        if e.response.status_code == 404:
            raise HTTPException(404, "Buch nicht gefunden")
        if e.response.status_code == 429:
            raise HTTPException(429, "Google Books API: Rate-Limit erreicht, bitte kurz warten.")
        raise HTTPException(502, "Google Books API ist nicht erreichbar.")
    except httpx.RequestError as e:
        logger.warning("Google Books API nicht erreichbar: %s", type(e).__name__)
        raise HTTPException(502, "Google Books API ist nicht erreichbar.")

    cache_set(cache_key, data)
    return data


@app.get("/api/config")
async def config():
    return {
        "geminiConfigured": bool(GEMINI_API_KEY),
        "googleBooksKeyConfigured": bool(GOOGLE_BOOKS_API_KEY),
    }


@app.get("/api/search")
async def search(q: str):
    if not q.strip():
        raise HTTPException(400, "q is required")
    data = await google_books_request({"q": q, "maxResults": 12})
    items = [normalize_volume(item) for item in data.get("items", [])]
    return {"items": items}


@app.get("/api/isbn/{isbn}")
async def by_isbn(isbn: str):
    isbn = re.sub(r"[^0-9Xx]", "", isbn)
    data = await google_books_request({"q": f"isbn:{isbn}"})
    items = data.get("items", [])
    if not items:
        raise HTTPException(404, "Kein Buch zu dieser ISBN gefunden")
    return normalize_volume(items[0])


@app.get("/api/volume/{volume_id}")
async def by_volume_id(volume_id: str):
    data = await google_books_request({}, url=f"{GOOGLE_BOOKS_URL}/{volume_id}")
    return normalize_volume(data)


async def fetch_open_library_rating(title: str, author: str) -> dict | None:
    query = f"{title} {author}".strip()
    cache_key = f"openlibrary:{query.lower()}"
    cached = cache_get(cache_key)
    if cached is not CACHE_MISS:
        return cached

    result = None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{OPEN_LIBRARY_URL}/search.json",
                params={"q": query, "fields": "key", "limit": 1},
            )
            resp.raise_for_status()
            docs = resp.json().get("docs") or []
            work_key = docs[0].get("key") if docs else None

            if work_key:
                resp = await client.get(f"{OPEN_LIBRARY_URL}{work_key}/ratings.json")
                resp.raise_for_status()
                summary = resp.json().get("summary") or {}
                if summary.get("average") is not None:
                    result = {
                        "rating": summary.get("average"),
                        "ratingsCount": summary.get("count"),
                        "url": f"{OPEN_LIBRARY_URL}{work_key}",
                    }
    except (httpx.HTTPError, json.JSONDecodeError) as e:
        logger.warning("Open-Library-Abfrage fehlgeschlagen: %s", type(e).__name__)
        return {"error": "Bewertungsabfrage fehlgeschlagen"}

    cache_set(cache_key, result)
    return result


async def generate_ai_insights(title: str, author: str, description: str) -> dict | None:
    if not GEMINI_API_KEY:
        return None

    cache_key = f"ai:{title.lower()}:{author.lower()}"
    cached = cache_get(cache_key)
    if cached is not CACHE_MISS:
        return cached

    prompt = f"""Du bekommst Informationen zu einem Buch. Antworte AUSSCHLIESSLICH mit validem JSON
im folgenden Format, auf Deutsch:
{{
  "summary": "2-3 Sätze Kurzzusammenfassung des Buchs",
  "tags": ["Tag1", "Tag2", "..."],
  "pros": ["Pro-Punkt 1", "Pro-Punkt 2", "..."],
  "cons": ["Contra-Punkt 1", "Contra-Punkt 2", "..."]
}}
Nutze maximal 6 Tags und maximal 5 Pro- und 5 Contra-Punkte, jeweils kurz (max. 12 Wörter).
Leite Pro/Contra aus der Beschreibung ab; wenn wenig Information vorhanden ist,
gib plausible, vorsichtig formulierte Punkte.

Titel: {title}
Autor: {author}
Beschreibung: {description or "(keine Beschreibung verfügbar)"}
"""

    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"response_mime_type": "application/json"},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_URL, params={"key": GEMINI_API_KEY}, json=body
            )
            resp.raise_for_status()
            data = resp.json()
        parts = data["candidates"][0]["content"]["parts"]
        text = next(p["text"] for p in parts if "text" in p)
        result = json.loads(text)
    except (httpx.HTTPError, KeyError, IndexError, StopIteration, json.JSONDecodeError) as e:
        logger.warning("KI-Auswertung fehlgeschlagen: %s", e)
        return {"error": "KI-Auswertung fehlgeschlagen"}

    cache_set(cache_key, result)
    return result


@app.post("/api/enrich")
async def enrich(payload: dict):
    title = (payload.get("title") or "").strip()
    author = (payload.get("author") or "").strip()
    description = payload.get("description") or ""
    if not title:
        raise HTTPException(400, "title is required")

    rating = await fetch_open_library_rating(title, author)
    ai = await generate_ai_insights(title, author, description)

    return {"openLibrary": rating, "ai": ai}


static_dir = Path(__file__).parent.parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
