const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const Parser = require("rss-parser");
const path = require("path");
const sources = require("./data/sources.json");

const PORT = process.env.PORT || 3000;
const REFRESH_MINUTES = process.env.REFRESH_MINUTES || 15;
const FETCH_TIMEOUT_MS = 10000;
// Guards against many visitors hammering "Refresh now" at once, which would
// otherwise fire a full RSS refetch (22+ outbound requests) per click and
// risk getting this server's IP rate-limited or blocked by outlets.
const MIN_MANUAL_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    // A real browser UA. Generic "bot" UAs get blocked by several outlets' firewalls.
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
  },
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
let lastRefreshTime = 0;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// Turns raw RSS description/content into a clean, readable one- or
// two-sentence summary: strips HTML tags and entities, then cuts at the
// nearest sentence boundary instead of mid-word or mid-sentence.
function summarize(raw, maxLen = 220) {
  if (!raw) return "";
  let text = raw.replace(/<[^>]*>/g, " ");
  const entities = {
    "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'",
    "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&rsquo;": "'", "&lsquo;": "'",
    "&rdquo;": '"', "&ldquo;": '"', "&mdash;": "—", "&ndash;": "–",
  };
  text = text.replace(/&amp;|&quot;|&#39;|&apos;|&lt;|&gt;|&nbsp;|&rsquo;|&lsquo;|&rdquo;|&ldquo;|&mdash;|&ndash;/g, (m) => entities[m]);
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;

  const truncated = text.slice(0, maxLen);
  const lastSentenceEnd = Math.max(truncated.lastIndexOf(". "), truncated.lastIndexOf("? "), truncated.lastIndexOf("! "));
  if (lastSentenceEnd > maxLen * 0.4) {
    return truncated.slice(0, lastSentenceEnd + 1);
  }
  const lastSpace = truncated.lastIndexOf(" ");
  return truncated.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
}

// A handful of common words to ignore when matching articles on the same
// story across outlets (see "compare coverage" below).
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "from", "by", "as", "is", "are", "was", "were", "be", "been",
  "this", "that", "it", "its", "after", "over", "into", "amid", "than",
  "will", "says", "say", "said", "new", "how", "why", "what", "who",
]);

function significantWords(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

async function fetchOneSource(source) {
  try {
    const feed = await withTimeout(parser.parseURL(source.feed), FETCH_TIMEOUT_MS);
    const items = (feed.items || []).slice(0, 15).map((item) => ({
      title: item.title || "(untitled)",
      link: item.link,
      pubDate: item.pubDate || item.isoDate || null,
      snippet: summarize(item.contentSnippet || item.content || item.summary || item.description || ""),
      sourceId: source.id,
      sourceName: source.name,
      country: source.country,
      countryCode: source.countryCode,
      bias: source.bias,
      category: source.category || "World",
      biasNote: source.note || "",
    }));
    return { ok: true, id: source.id, items };
  } catch (err) {
    return { ok: false, id: source.id, error: err.message };
  }
}

async function refreshCache() {
  lastRefreshTime = Date.now();
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

  // Tag each article with its significant title words once, up front, so
  // the frontend can group same-story coverage across outlets without any
  // extra API calls or server work per request.
  allArticles = allArticles.map((a) => ({ ...a, keywords: significantWords(a.title) }));

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
  const { country, bias, category } = req.query;
  let articles = cache.articles;

  if (country && country.toUpperCase() !== "WORLD") {
    articles = articles.filter(
      (a) => a.countryCode && a.countryCode.toUpperCase() === country.toUpperCase()
    );
  }
  if (bias) {
    articles = articles.filter((a) => a.bias.toLowerCase() === bias.toLowerCase());
  }
  if (category && category.toLowerCase() !== "all") {
    articles = articles.filter((a) => (a.category || "World").toLowerCase() === category.toLowerCase());
  }

  res.json({
    lastUpdated: cache.lastUpdated,
    count: articles.length,
    articles,
  });
});

app.get("/api/categories", (req, res) => {
  const seen = new Set();
  for (const s of sources) seen.add(s.category || "World");
  // Keep World first, then alphabetical — matches how a normal news site orders its nav.
  const rest = Array.from(seen).filter((c) => c !== "World").sort();
  res.json(["World", ...rest]);
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
  // Throttled: if someone already refreshed recently (including the
  // scheduled cron), serve the existing cache instead of firing another
  // full round of outbound RSS requests. Protects the server — and the
  // outlets' feeds — when many people use the site at once.
  if (Date.now() - lastRefreshTime < MIN_MANUAL_REFRESH_INTERVAL_MS) {
    return res.json({ ok: true, lastUpdated: cache.lastUpdated, throttled: true });
  }
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

