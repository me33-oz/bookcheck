# BookCheck

Web-App zum Scannen von Buch-Barcodes oder Cover, oder zur Textsuche nach Büchern.
Zeigt Bewertungen (Google Books + Open Library), Preis, KI-Kurzzusammenfassung, Tags und eine Pro/Contra-Liste.
Komplett kostenlos nutzbar.

## Setup

```bash
pip install -r requirements.txt
```

Kopiere `.env.example` nach `.env` und trage deinen Key ein (optional, App läuft auch ohne):

- `GEMINI_API_KEY` – für KI-Zusammenfassung/Tags/Pro-Contra (kostenloser Free-Tier: https://aistudio.google.com/apikey)
- `GOOGLE_BOOKS_API_KEY` – **dringend empfohlen**, sonst kommt schnell "Rate-Limit erreicht"
  (v.a. bei gehosteten Apps mit geteilter IP wie Render). Kostenlos erstellen:
  1. [console.cloud.google.com](https://console.cloud.google.com/) öffnen, ein Projekt anlegen (oder vorhandenes nutzen)
  2. "APIs & Services" → "Library" → nach "Books API" suchen → aktivieren
  3. "APIs & Services" → "Credentials" → "Create Credentials" → "API key"
  4. Den Key kopieren und hier eintragen

## Starten

```bash
uvicorn server.main:app --reload --port 8000
```

Dann [http://localhost:8000](http://localhost:8000) öffnen.

## Deployment aufs Handy (immer aktuell über GitHub)

Damit Barcode-Scan auf dem Handy funktioniert, braucht die App HTTPS – dafür eignet sich ein
kostenloser Auto-Deploy-Dienst wie [Render](https://render.com), der bei jedem `git push` automatisch
neu deployt:

1. Erstelle auf [github.com/new](https://github.com/new) ein neues Repository (leer, ohne README).
2. Lokal pushen:
   ```bash
   git remote add origin https://github.com/<dein-user>/<dein-repo>.git
   git push -u origin main
   ```
3. Auf [render.com](https://render.com) einloggen → "New +" → "Blueprint" → das GitHub-Repo auswählen
   (Render erkennt automatisch `render.yaml` aus diesem Projekt).
4. Beim ersten Deploy nach `GEMINI_API_KEY` und `GOOGLE_BOOKS_API_KEY` fragen lassen und eintragen –
   diese Werte bleiben in Render und landen nie im Git-Repo (siehe `.gitignore`). Schon deployt und
   Rate-Limit-Fehler? Nachträglich unter "Environment" im Render-Dashboard eintragen, Render deployt
   dann automatisch neu.
5. Render gibt dir eine HTTPS-URL wie `https://bookcheck.onrender.com` – die kannst du auf dem Handy öffnen.
   Die App hat ein PWA-Manifest + Service Worker, Chrome/Android zeigt daher von selbst ein
   "App installieren"-Banner an (oder Menü → "App installieren"); auf iPhone/Safari über
   "Teilen" → "Zum Home-Bildschirm" hinzufügen.

Jeder weitere `git push` aktualisiert die Live-Version automatisch – kein manuelles Redeploy nötig.
Der kostenlose Render-Tarif schläft nach ca. 15 Minuten Inaktivität ein; der erste Aufruf danach
dauert dann ~30-60 Sekunden zum Aufwecken.

## Hinweise

- **Barcode-Scan** nutzt die Gerätekamera direkt im Browser (EAN-13/ISBN). Funktioniert auf dem Handy nur über HTTPS oder `localhost`.
- **Cover-Scan** ist eine Texterkennung (OCR) des fotografierten Covers, kein echter Bildabgleich – der erkannte Text wird als Suchanfrage genutzt und kann vor der Suche angepasst werden.
- **Bewertungen** kommen aus zwei kostenlosen, offiziellen APIs: Google Books und Open Library. Die offizielle Goodreads-API ist seit 2020 für neue Entwickler nicht mehr verfügbar; ein Scraper (z.B. über Apify) wäre kostenpflichtig und verstößt gegen Goodreads' Nutzungsbedingungen, deshalb wird das hier nicht genutzt.
- **Preise** stammen aus der Google Books API (`saleInfo.listPrice`) und sind nur verfügbar, wenn Google Play Books das Buch mit Preis listet.
