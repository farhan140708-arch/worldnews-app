// If you split hosting (frontend on Netlify, backend on Render/Railway/etc.),
// set this to your backend's full URL, e.g. "https://your-app.onrender.com".
// Leave it empty to call the API on the same origin.
const API_BASE = "https://worldnews-app.onrender.com"; // <-- fill this in if frontend and backend are on different hosts

const biasColors = {
  "Left": "var(--left)",
  "Lean Left": "var(--lean-left)",
  "Center": "var(--center)",
  "Lean Right": "var(--lean-right)",
  "Right": "var(--right)",
  "State-controlled": "var(--state)",
};

const SAVE_KEY = "compass_saved_v1";
const THEME_KEY = "compass_theme";

const scopeSelect = document.getElementById("scope");
const biasFilter = document.getElementById("biasFilter");
const searchBox = document.getElementById("searchBox");
const savedToggle = document.getElementById("savedToggle");
const refreshBtn = document.getElementById("refreshBtn");
const lastUpdatedEl = document.getElementById("lastUpdated");
const newsList = document.getElementById("newsList");
const biasBar = document.getElementById("biasBar");
const trendingSection = document.getElementById("trendingSection");
const statusBanner = document.getElementById("statusBanner");
const sourcesPanel = document.getElementById("sourcesPanel");
const showSourcesLink = document.getElementById("showSourcesLink");
const categoryNav = document.getElementById("categoryNav");
const themeToggle = document.getElementById("themeToggle");

let currentArticles = []; // last fetched set for the active region/bias/category filter
let savedOnlyActive = false;
let activeCategory = "World";

// ---------- Theme ----------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem(THEME_KEY, theme);
}
applyTheme(localStorage.getItem(THEME_KEY) || "light");
themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ---------- Country flags ----------

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

// ---------- Saved articles (stored in this browser only) ----------

function getSavedMap() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
  } catch (err) {
    return {};
  }
}
function setSavedMap(map) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(map));
}
function isSaved(link) {
  return Boolean(getSavedMap()[link]);
}
function toggleSaved(article) {
  const map = getSavedMap();
  if (map[article.link]) {
    delete map[article.link];
  } else {
    map[article.link] = article;
  }
  setSavedMap(map);
}

// ---------- Helpers ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return "unknown time";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr ago`;
}

function showBanner(message) {
  statusBanner.textContent = message;
  statusBanner.classList.remove("hidden");
}
function hideBanner() {
  statusBanner.classList.add("hidden");
}

// ---------- Compare coverage: find other outlets covering the same story ----------

function findRelated(article, pool) {
  const keywords = article.keywords || [];
  if (!keywords.length) return [];
  const setA = new Set(keywords);
  const matches = [];
  for (const other of pool) {
    if (other.link === article.link) continue;
    if (other.sourceId === article.sourceId) continue;
    const shared = (other.keywords || []).filter((w) => setA.has(w));
    if (shared.length >= 2) matches.push(other);
    if (matches.length >= 4) break;
  }
  return matches;
}

// ---------- Trending: stories multiple outlets are covering right now ----------

function computeTrending(articles) {
  const used = new Set();
  const clusters = [];
  for (const a of articles) {
    if (used.has(a.link)) continue;
    const related = findRelated(a, articles);
    if (related.length >= 2) {
      const group = [a, ...related];
      group.forEach((g) => used.add(g.link));
      clusters.push(group);
    }
  }
  clusters.sort((x, y) => y.length - x.length);
  return clusters.slice(0, 5);
}

function renderTrending(articles) {
  const clusters = computeTrending(articles);
  if (!clusters.length) {
    trendingSection.classList.add("hidden");
    return;
  }
  const items = clusters
    .map((group) => {
      const lead = group[0];
      const dots = group
        .slice(0, 5)
        .map((g) => `<span class="trending-dot" style="background:${biasColors[g.bias] || "var(--center)"}"></span>`)
        .join("");
      return `
        <div class="trending-item">
          <span class="trending-count">${group.length} outlets</span>
          <a href="${lead.link}" target="_blank" rel="noopener">${escapeHtml(lead.title)}</a>
          <span class="trending-dots">${dots}</span>
        </div>`;
    })
    .join("");
  trendingSection.innerHTML = `<p class="trending-title">🔥 Trending — covered across outlets</p><div class="trending-list">${items}</div>`;
  trendingSection.classList.remove("hidden");
}

// ---------- Bias breakdown bar ----------

function renderBiasBar(articles) {
  if (!articles.length) {
    biasBar.classList.add("hidden");
    return;
  }
  const counts = {};
  for (const a of articles) counts[a.bias] = (counts[a.bias] || 0) + 1;
  const total = articles.length;
  const order = ["Left", "Lean Left", "Center", "Lean Right", "Right", "State-controlled"];
  const present = order.filter((b) => counts[b]);

  const segs = present
    .map((b) => `<span class="bias-bar-seg" style="width:${(counts[b] / total) * 100}%; background:${biasColors[b]}"></span>`)
    .join("");
  const legend = present
    .map((b) => `<span><span class="bias-bar-dot" style="background:${biasColors[b]}"></span>${escapeHtml(b)} ${counts[b]}</span>`)
    .join("");

  biasBar.innerHTML = `<div class="bias-bar-track">${segs}</div><div class="bias-bar-legend">${legend}</div>`;
  biasBar.classList.remove("hidden");
}

// ---------- Rendering ----------

function getDisplayArticles() {
  let list = savedOnlyActive ? Object.values(getSavedMap()) : currentArticles;
  const q = searchBox.value.trim().toLowerCase();
  if (q) {
    list = list.filter((a) => `${a.title} ${a.snippet || ""}`.toLowerCase().includes(q));
  }
  return list;
}

function renderCard(a, pool) {
  const color = biasColors[a.bias] || "var(--center)";
  const dateStr = a.pubDate ? new Date(a.pubDate).toLocaleString() : "";
  const saved = isSaved(a.link);
  const related = findRelated(a, pool);
  const flag = a.countryCode === "GLOBAL" ? "🌐" : flagEmoji(a.countryCode);

  const relatedHtml = related.length
    ? `
      <button class="compare-toggle" type="button">See ${related.length} other outlet${related.length > 1 ? "s" : ""} on this story ▾</button>
      <div class="compare-panel hidden">
        ${related
          .map(
            (r) => `
          <div class="compare-item">
            <span class="compare-badge" style="background:${biasColors[r.bias] || "var(--center)"}">${escapeHtml(r.bias)}</span>
            <a href="${r.link}" target="_blank" rel="noopener">${escapeHtml(r.sourceName)}: ${escapeHtml(r.title)}</a>
          </div>`
          )
          .join("")}
      </div>`
    : "";

  return `
    <div class="card" data-link="${escapeHtml(a.link)}">
      <div class="card-top">
        <span class="source-name">${escapeHtml(a.sourceName)}</span>
        <div class="card-top-right">
          <button class="save-btn ${saved ? "saved" : ""}" type="button" title="Save for later">${saved ? "★" : "☆"}</button>
          <span class="bias-badge" style="background:${color}" title="${escapeHtml(a.biasNote || "")}">${escapeHtml(a.bias)}</span>
        </div>
      </div>
      <h3><a href="${a.link}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></h3>
      <p>${escapeHtml(a.snippet)}</p>
      <div class="meta">${flag} ${escapeHtml(a.country)} · ${dateStr}</div>
      ${relatedHtml}
    </div>
  `;
}

function renderCurrentView() {
  const displayed = getDisplayArticles();
  renderBiasBar(displayed);
  renderTrending(currentArticles);

  if (!displayed.length) {
    const msg = savedOnlyActive
      ? `You haven't saved anything yet — click the ☆ on any story to keep it here.`
      : `No articles matched right now. Try "World" or clear the bias filter, or hit Refresh — the backend may still be waking up (free hosting sleeps after inactivity).`;
    newsList.innerHTML = `<p class="empty">${msg}</p>`;
    return;
  }

  // Compare-coverage always matches against the full current filter set, so
  // it still works while a search or the saved view narrows what's shown.
  const pool = currentArticles.length ? currentArticles : displayed;
  newsList.innerHTML = displayed.map((a) => renderCard(a, pool)).join("");
}

// Event delegation: one listener handles every card's save button and
// compare-coverage toggle, including cards added after later refreshes.
newsList.addEventListener("click", (e) => {
  const saveBtn = e.target.closest(".save-btn");
  if (saveBtn) {
    const card = saveBtn.closest(".card");
    const link = card.dataset.link;
    const article =
      currentArticles.find((a) => a.link === link) ||
      Object.values(getSavedMap()).find((a) => a.link === link);
    if (article) {
      toggleSaved(article);
      renderCurrentView();
    }
    return;
  }
  const compareBtn = e.target.closest(".compare-toggle");
  if (compareBtn) {
    compareBtn.nextElementSibling.classList.toggle("hidden");
  }
});

async function checkSourceHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    const statuses = Object.values(data.sourceStatus || {});
    const failed = statuses.filter((s) => s !== "ok").length;
    const total = statuses.length;
    if (total > 0 && failed === total) {
      showBanner(
        "None of the news sources responded on the last refresh. This can happen right after the backend wakes up from sleep — try Refresh in a moment."
      );
    } else if (total > 0 && failed / total > 0.5) {
      showBanner(
        `${failed} of ${total} sources failed to load on the last refresh. Showing articles from the ones that worked.`
      );
    } else {
      hideBanner();
    }
  } catch (err) {
    showBanner("Can't reach the backend at all. Check that API_BASE in app.js points to your live Render URL.");
  }
}

async function loadCountries() {
  try {
    const res = await fetch(`${API_BASE}/api/countries`);
    const countries = await res.json();
    for (const c of countries) {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.name;
      scopeSelect.appendChild(opt);
    }
  } catch (err) {
    // Non-fatal — the world view still works without the country list.
  }
}

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    const categories = await res.json();
    categoryNav.innerHTML = categories
      .map((c) => `<button class="cat-btn ${c === "World" ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join("");
  } catch (err) {
    // Non-fatal — World-only nav (already in the HTML) still works.
  }
}

categoryNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;
  activeCategory = btn.dataset.cat;
  categoryNav.querySelectorAll(".cat-btn").forEach((b) => b.classList.toggle("active", b === btn));
  loadNews();
});

async function loadNews() {
  const country = scopeSelect.value;
  const bias = biasFilter.value;
  const params = new URLSearchParams();
  if (country && country !== "WORLD") params.set("country", country);
  if (bias) params.set("bias", bias);
  if (activeCategory && activeCategory !== "World") params.set("category", activeCategory);

  newsList.innerHTML = `<p class="loading">Loading news…</p>`;
  try {
    const res = await fetch(`${API_BASE}/api/news?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentArticles = data.articles || [];
    lastUpdatedEl.textContent = data.lastUpdated ? `Refreshed ${timeAgo(data.lastUpdated)}` : "";
    renderCurrentView();
    await checkSourceHealth();
  } catch (err) {
    newsList.innerHTML = `<p class="empty">Couldn't reach the backend. If you just deployed, it may still be waking up — wait 30 seconds and hit Refresh. Otherwise check that API_BASE in app.js matches your Render URL exactly.</p>`;
  }
}

async function loadSources() {
  const res = await fetch(`${API_BASE}/api/sources`);
  const sources = await res.json();
  sourcesPanel.innerHTML = `
    <p>Bias labels below are approximate starting classifications, meant as a transparency signal, not a scientific measurement. Read across sources rather than trusting one.</p>
    <table>
      <tr><th>Source</th><th>Country</th><th>Bias label</th><th>Feed status</th></tr>
      ${sources
        .map((s) => {
          const ok = s.status === "ok";
          return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.country)}</td><td>${escapeHtml(s.bias)}</td><td class="${ok ? "status-ok" : "status-fail"}">${escapeHtml(s.status)}</td></tr>`;
        })
        .join("")}
    </table>
  `;
}

showSourcesLink.addEventListener("click", async () => {
  const isHidden = sourcesPanel.classList.contains("hidden");
  if (isHidden) await loadSources();
  sourcesPanel.classList.toggle("hidden");
});

scopeSelect.addEventListener("change", loadNews);
biasFilter.addEventListener("change", loadNews);

let searchDebounce;
searchBox.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderCurrentView, 150);
});

savedToggle.addEventListener("click", () => {
  savedOnlyActive = !savedOnlyActive;
  savedToggle.classList.toggle("active", savedOnlyActive);
  savedToggle.textContent = savedOnlyActive ? "★ Saved" : "☆ Saved";
  renderCurrentView();
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.textContent = "Refreshing…";
  try {
    await fetch(`${API_BASE}/api/refresh`);
  } catch (err) {
    // still try to reload whatever is cached
  }
  await loadNews();
  refreshBtn.textContent = "↻ Refresh";
});

setInterval(loadNews, 5 * 60 * 1000);

loadCountries();
loadCategories().then(loadNews);
