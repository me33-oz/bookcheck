const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const barcodeBtn = document.getElementById("barcodeBtn");
const coverInput = document.getElementById("coverInput");
const barcodeReader = document.getElementById("barcodeReader");
const ocrStatus = document.getElementById("ocrStatus");
const resultsGrid = document.getElementById("resultsGrid");
const detailEl = document.getElementById("detail");

let html5QrCode = null;
let config = { geminiConfigured: false };

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    config = await res.json();
  } catch (e) {
    console.error("Config konnte nicht geladen werden", e);
  }
}

function showStatus(el, message) {
  el.hidden = false;
  el.textContent = message;
}
function hideStatus(el) {
  el.hidden = true;
  el.textContent = "";
}

async function doSearch(query) {
  if (!query.trim()) return;
  detailEl.hidden = true;
  resultsGrid.innerHTML = "<p class='muted-note'>Suche läuft...</p>";
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      resultsGrid.innerHTML = `<p class='muted-note'>${escapeHtml(err.detail || "Fehler bei der Suche.")}</p>`;
      return;
    }
    const data = await res.json();
    renderResults(data.items || []);
  } catch (e) {
    resultsGrid.innerHTML = "<p class='muted-note'>Fehler bei der Suche.</p>";
  }
}

function renderResults(items) {
  if (!items.length) {
    resultsGrid.innerHTML = "<p class='muted-note'>Keine Treffer gefunden.</p>";
    return;
  }
  resultsGrid.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <img src="${item.thumbnail || ""}" alt="Cover" onerror="this.style.visibility='hidden'" />
      <div class="title">${escapeHtml(item.title || "Unbekannt")}</div>
      <div class="author">${escapeHtml((item.authors || []).join(", "))}</div>
    `;
    card.addEventListener("click", () => showDetail(item));
    resultsGrid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function starRating(rating) {
  if (rating == null) return "–";
  return `${Number(rating).toFixed(1)} ★`;
}

async function showDetail(item) {
  resultsGrid.innerHTML = "";
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <button class="back-btn" id="backBtn">&larr; Zurück zu den Ergebnissen</button>
    <div class="detail-top">
      <img src="${item.thumbnail || ""}" alt="Cover" onerror="this.style.visibility='hidden'" />
      <div>
        <h2>${escapeHtml(item.title || "Unbekannt")}</h2>
        <div class="author">${escapeHtml((item.authors || []).join(", "))}</div>
        <div class="ratings-row">
          <span class="rating-pill">Google: ${starRating(item.googleRating)}${item.googleRatingsCount ? ` (${item.googleRatingsCount})` : ""}</span>
          <span class="rating-pill" id="openLibraryPill">Open Library: lädt...</span>
          ${item.price ? `<span class="price-pill">${item.price.amount} ${item.price.currency}</span>` : `<span class="price-pill">Preis unbekannt</span>`}
        </div>
      </div>
    </div>

    <div class="section-title">Beschreibung</div>
    <div class="description">${item.description ? escapeHtml(item.description) : "<span class='muted-note'>Keine Beschreibung verfügbar.</span>"}</div>

    <div class="section-title">Tags</div>
    <div class="tags" id="tagsBox">
      ${(item.categories || []).map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join("") || "<span class='muted-note'>lädt...</span>"}
    </div>

    <div class="section-title">Kurzzusammenfassung</div>
    <div class="description" id="summaryBox">${config.geminiConfigured ? "lädt..." : "<span class='muted-note'>KI nicht konfiguriert (GEMINI_API_KEY fehlt).</span>"}</div>

    <div class="section-title">Pro &amp; Contra</div>
    <div class="pro-con" id="proConBox">
      <div class="pros"><h4>Pro</h4><ul><li class="muted-note">${config.geminiConfigured ? "lädt..." : "nicht verfügbar"}</li></ul></div>
      <div class="cons"><h4>Contra</h4><ul><li class="muted-note">${config.geminiConfigured ? "lädt..." : "nicht verfügbar"}</li></ul></div>
    </div>
  `;

  document.getElementById("backBtn").addEventListener("click", () => {
    detailEl.hidden = true;
  });

  enrichDetail(item);
}

async function enrichDetail(item) {
  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        author: (item.authors || [])[0] || "",
        description: item.description || "",
      }),
    });
    const data = await res.json();
    applyOpenLibrary(data.openLibrary);
    applyAi(data.ai, item);
  } catch (e) {
    console.error(e);
  }
}

function applyOpenLibrary(rating) {
  const pill = document.getElementById("openLibraryPill");
  if (!pill) return;
  if (!rating) {
    pill.textContent = "Open Library: keine Daten gefunden";
    return;
  }
  if (rating.error) {
    pill.textContent = "Open Library: Fehler bei Abfrage";
    return;
  }
  pill.textContent = `Open Library: ${starRating(rating.rating)}${rating.ratingsCount ? ` (${rating.ratingsCount})` : ""}`;
  if (rating.url) {
    pill.innerHTML = `<a href="${rating.url}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${pill.textContent}</a>`;
  }
}

function applyAi(ai, item) {
  const summaryBox = document.getElementById("summaryBox");
  const tagsBox = document.getElementById("tagsBox");
  const proConBox = document.getElementById("proConBox");

  if (!ai) {
    if (config.geminiConfigured) summaryBox.innerHTML = "<span class='muted-note'>Keine Zusammenfassung verfügbar.</span>";
    return;
  }
  if (ai.error) {
    summaryBox.innerHTML = `<span class='muted-note'>${escapeHtml(ai.error)}</span>`;
    return;
  }

  summaryBox.textContent = ai.summary || "–";

  const existingTags = (item.categories || []).map((c) => c.toLowerCase());
  const aiTags = (ai.tags || []).filter((t) => !existingTags.includes(t.toLowerCase()));
  if (aiTags.length) {
    tagsBox.innerHTML += aiTags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  } else if (!(item.categories || []).length) {
    tagsBox.innerHTML = "<span class='muted-note'>Keine Tags verfügbar.</span>";
  }

  const prosHtml = (ai.pros || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("") || "<li class='muted-note'>–</li>";
  const consHtml = (ai.cons || []).map((c) => `<li>${escapeHtml(c)}</li>`).join("") || "<li class='muted-note'>–</li>";
  proConBox.innerHTML = `
    <div class="pros"><h4>Pro</h4><ul>${prosHtml}</ul></div>
    <div class="cons"><h4>Contra</h4><ul>${consHtml}</ul></div>
  `;
}

searchBtn.addEventListener("click", () => doSearch(searchInput.value));
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch(searchInput.value);
});

barcodeBtn.addEventListener("click", async () => {
  if (html5QrCode) {
    await stopBarcodeScanner();
    return;
  }
  barcodeReader.hidden = false;
  barcodeBtn.textContent = "⏹️ Scan abbrechen";
  html5QrCode = new Html5Qrcode("barcodeReader");
  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 120 },
        formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8],
      },
      async (decodedText) => {
        await stopBarcodeScanner();
        searchInput.value = decodedText;
        showStatus(ocrStatus, `Barcode erkannt: ${decodedText} – suche...`);
        try {
          const res = await fetch(`/api/isbn/${encodeURIComponent(decodedText)}`);
          if (!res.ok) throw new Error("not found");
          const item = await res.json();
          hideStatus(ocrStatus);
          renderResults([]);
          showDetail(item);
        } catch (e) {
          hideStatus(ocrStatus);
          doSearch(decodedText);
        }
      },
      () => {}
    );
  } catch (e) {
    showStatus(ocrStatus, "Kamera konnte nicht gestartet werden: " + e);
    await stopBarcodeScanner();
  }
});

async function stopBarcodeScanner() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) {
      // ignore
    }
    html5QrCode = null;
  }
  barcodeReader.hidden = true;
  barcodeBtn.textContent = "📷 Barcode scannen";
}

coverInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showStatus(ocrStatus, "Text auf Cover wird erkannt...");
  try {
    const { data } = await Tesseract.recognize(file, "eng+deu");
    const rawText = (data.text || "").trim();
    const guess = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 2)
      .slice(0, 3)
      .join(" ");
    hideStatus(ocrStatus);
    if (guess) {
      searchInput.value = guess;
      showStatus(ocrStatus, `Erkannt: "${guess}" – Ergebnis prüfen und ggf. Suchfeld anpassen.`);
      doSearch(guess);
    } else {
      showStatus(ocrStatus, "Kein Text auf dem Cover erkannt. Bitte manuell suchen.");
    }
  } catch (err) {
    showStatus(ocrStatus, "Texterkennung fehlgeschlagen.");
  }
  coverInput.value = "";
});

loadConfig();
