// If you split hosting (frontend on Netlify, backend on Render/Railway/etc.),
// set this to your backend's full URL, e.g. "https://your-app.onrender.com".
// Leave it empty to call the API on the same origin (e.g. running everything
// from one server, or Netlify redirects/proxying to your backend).
  const API_BASE = "https://worldnews-app-xxxx.onrender.com";// <-- fill this in if frontend and backend are on different hosts

const biasColors = {
  "Left": "var(--left)",
  "Lean Left": "var(--lean-left)",
  "Center": "var(--center)",
  "Lean Right": "var(--lean-right)",
  "Right": "var(--right)",
  "State-controlled": "var(--state)",
};

const scopeSelect = document.getElementById("scope");
const biasFilter = document.getElementById("biasFilter");
const refreshBtn = document.getElementById("refreshBtn");
const lastUpdatedEl = document.getElementById("lastUpdated");
const newsList = document.getElementById("newsList");
const sourcesPanel = document.getElementById("sourcesPanel");
const showSourcesLink = document.getElementById("showSourcesLink");

async function loadCountries() {
  const res = await fetch(`${API_BASE}/api/countries`);
  const countries = await res.json();
  for (const c of countries) {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = c.name;
    scopeSelect.appendChild(opt);
  }
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

function renderArticles(data) {
  lastUpdatedEl.textContent = data.lastUpdated
    ? `Feed refreshed ${timeAgo(data.lastUpdated)}`
    : "";

  if (!data.articles.length) {
    newsList.innerHTML = `<p class="empty">No articles matched your filters yet. Try "World" or clear the bias filter.</p>`;
    return;
  }

  newsList.innerHTML = data.articles
    .map((a) => {
      const color = biasColors[a.bias] || "var(--center)";
      const dateStr = a.pubDate ? new Date(a.pubDate).toLocaleString() : "";
      return `
        <div class="card">
          <div class="card-top">
            <span class="source-name">${escapeHtml(a.sourceName)} · ${escapeHtml(a.country)}</span>
            <span class="bias-badge" style="background:${color}" title="${escapeHtml(a.biasNote || "")}">${escapeHtml(a.bias)}</span>
          </div>
          <h3><a href="${a.link}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></h3>
          <p>${escapeHtml(a.snippet)}</p>
          <div class="meta">${dateStr}</div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function loadNews() {
  const country = scopeSelect.value;
  const bias = biasFilter.value;
  const params = new URLSearchParams();
  if (country && country !== "WORLD") params.set("country", country);
  if (bias) params.set("bias", bias);

  newsList.innerHTML = `<p class="loading">Loading news…</p>`;
  try {
    const res = await fetch(`${API_BASE}/api/news?${params.toString()}`);
    const data = await res.json();
    renderArticles(data);
  } catch (err) {
    newsList.innerHTML = `<p class="empty">Couldn't reach the server. Is the backend running?</p>`;
  }
}

async function loadSources() {
  const res = await fetch(`${API_BASE}/api/sources`);
  const sources = await res.json();
  sourcesPanel.innerHTML = `
    <p>Bias labels below are approximate starting classifications (Left / Lean Left / Center / Lean Right / Right / State-controlled), meant as a transparency signal, not a scientific measurement. Everyone draws these lines differently — treat this as a starting point, read across sources, and adjust the underlying data file if you disagree.</p>
    <table>
      <tr><th>Source</th><th>Country</th><th>Bias label</th><th>Feed status</th></tr>
      ${sources
        .map(
          (s) =>
            `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.country)}</td><td>${escapeHtml(s.bias)}</td><td>${escapeHtml(s.status)}</td></tr>`
        )
        .join("")}
    </table>
  `;
}

showSourcesLink.addEventListener("click", async (e) => {
  e.preventDefault();
  const isHidden = sourcesPanel.classList.contains("hidden");
  if (isHidden) await loadSources();
  sourcesPanel.classList.toggle("hidden");
});

scopeSelect.addEventListener("change", loadNews);
biasFilter.addEventListener("change", loadNews);
refreshBtn.addEventListener("click", async () => {
  refreshBtn.textContent = "Refreshing…";
  await fetch(`${API_BASE}/api/refresh`);
  await loadNews();
  refreshBtn.textContent = "Refresh now";
});

// Auto-poll the (server-cached) feed every 5 minutes so open tabs stay current.
setInterval(loadNews, 5 * 60 * 1000);

loadCountries().then(loadNews);
