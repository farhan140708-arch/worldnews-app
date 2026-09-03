const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const Parser = require("rss-parser");
const path = require("path");
const sources = require("./data/sources.json");

const PORT = process.env.PORT || 3000;
const REFRESH_MINUTES = process.env.REFRESH_MINUTES || 15;
const FETCH_TIMEOUT_MS = 10000;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; WorldNewsAggregator/1.0)" },
});

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// In-memory cache. No database needed, no cost.
let cache = {
  articles: [],
  lastUpdated: null,
  sourceStatus: {}, // which feeds succeeded/failed on last run
};

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function fetchOneSource(source) {
  try {
    const feed = await withTimeout(parser.parseURL(source.feed), FETCH_TIMEOUT_MS);
    const items = (feed.items || []).slice(0, 15).map((item) => ({
      title: item.title || "(untitled)",
      link: item.link,
      pubDate: item.pubDate || item.isoDate || null,
      snippet: (item.contentSnippet || item.summary || "").slice(0, 280),
      sourceId: source.id,
      sourceName: source.name,
      country: source.country,
      countryCode: source.countryCode,
      bias: source.bias,
      biasNote: source.note || "",
    }));
    return { ok: true, id: source.id, items };
  } catch (err) {
    return { ok: false, id: source.id, error: err.message };
  }
}

async function refreshCache() {
  console.log(`[${new Date().toISOString()}] Refreshing news cache...`);
  const results = await Promise.all(sources.map(fetchOneSource));

  let allArticles = [];
  const status = {};
  for (const r of results) {
    status[r.id] = r.ok ? "ok" : `failed: ${r.error}`;
    if (r.ok) allArticles = allArticles.concat(r.items);
  }

  // Sort newest first where we have a date; undated items go to the end.
  allArticles.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  cache = {
    articles: allArticles,
    lastUpdated: new Date().toISOString(),
    sourceStatus: status,
  };

  const failed = Object.values(status).filter((s) => s !== "ok").length;
  console.log(
    `Refresh done: ${allArticles.length} articles from ${sources.length - failed}/${sources.length} sources.`
  );
}

// --- API routes ---

app.get("/api/news", (req, res) => {
  const { country, bias } = req.query;
  let articles = cache.articles;

  if (country && country.toUpperCase() !== "WORLD") {
    articles = articles.filter(
      (a) => a.countryCode && a.countryCode.toUpperCase() === country.toUpperCase()
    );
  }
  if (bias) {
    articles = articles.filter((a) => a.bias.toLowerCase() === bias.toLowerCase());
  }

  res.json({
    lastUpdated: cache.lastUpdated,
    count: articles.length,
    articles,
  });
});

app.get("/api/countries", (req, res) => {
  const seen = new Map();
  for (const s of sources) {
    if (!seen.has(s.countryCode)) seen.set(s.countryCode, s.country);
  }
  const list = Array.from(seen, ([code, name]) => ({ code, name })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  res.json(list);
});

app.get("/api/sources", (req, res) => {
  res.json(
    sources.map((s) => ({
      name: s.name,
      country: s.country,
      bias: s.bias,
      note: s.note,
      status: cache.sourceStatus[s.id] || "not fetched yet",
    }))
  );
});

app.get("/api/status", (req, res) => {
  res.json({
    lastUpdated: cache.lastUpdated,
    totalArticles: cache.articles.length,
    sourceStatus: cache.sourceStatus,
    refreshIntervalMinutes: Number(REFRESH_MINUTES),
  });
});

app.get("/api/refresh", async (req, res) => {
  // Manual trigger, useful for the free-tier "cron via external ping" setup described in README.
  await refreshCache();
  res.json({ ok: true, lastUpdated: cache.lastUpdated });
});

// Fallback to index.html for the frontend.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`World News server running on port ${PORT}`);
  refreshCache(); // initial fetch on boot
  cron.schedule(`*/${REFRESH_MINUTES} * * * *`, refreshCache);
});
