# World News (bias-transparent aggregator)

A self-hosted news app that pulls live RSS feeds from ~24 outlets around the
world, tags every article with the source's known editorial leaning, and lets
you filter by country or view everything as "World." No paid APIs, no
database, no accounts.

**Tested locally**: the server, routing, caching, and per-source error
handling all work correctly (verified before delivery). RSS fetches will fail
in a sandboxed environment with no general internet access — on real hosting
(step 2 below) they'll succeed normally.

## Important honesty notes (read this)

- **"Fully accurate" isn't a real property of any news aggregator.** This app
  doesn't fact-check claims; it aggregates what outlets publish and tells you
  who's publishing it and their general leaning, so you can read across
  sources instead of trusting one.
- **Bias labels are a starting point, not a measurement.** The labels in
  `backend/data/sources.json` are my own general, compiled approximation
  (Left / Lean Left / Center / Lean Right / Right / State-controlled). Two
  reasonable people will disagree about some of these. Edit the file freely —
  it's a plain JSON list.
- **RSS feed URLs break over time.** Outlets move or retire feeds without
  notice. If a source shows "failed" in the sources panel, find its current
  RSS URL (usually linked in the outlet's footer, or search
  "[outlet name] RSS feed") and swap it into `sources.json`.

## Project structure

```
worldnews-app/
  backend/
    server.js          # Express server: fetches RSS, caches, serves API + frontend
    package.json
    data/sources.json  # Edit this to add/remove/relabel sources
    public/            # Frontend (plain HTML/CSS/JS, no build step)
```

## Run it locally

```bash
cd backend
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy for free

**Render.com (recommended — no credit card required for the free tier as of
now; verify current terms, as free-tier policies change over time):**

1. Push this `worldnews-app` folder to a GitHub repo.
2. Go to render.com → New → Web Service → connect your repo.
3. Root directory: `backend`
4. Build command: `npm install`
5. Start command: `npm start`
6. Instance type: Free.
7. Deploy. Render gives you a URL like `https://your-app.onrender.com`.

**Free tier caveat:** Render's free web services spin down after ~15 minutes
of no traffic, and spin back up (slowly) on the next request. Two ways to
handle that, both free:

- Use **UptimeRobot** (free plan) to ping your `/api/status` URL every 5–10
  minutes. This keeps the service awake and doubles as your refresh trigger.
- Or just accept the occasional slow first load — the news itself is still
  cached and correct once it's up.

**Alternatives** (also free-tier, similar setup — root dir `backend`, build
`npm install`, start `npm start`): Railway, Fly.io, Cyclic. Check each
platform's current free-tier limits before committing, since these change.

## Deploying with Netlify (frontend) + Render (backend)

Netlify only runs static sites and short-lived serverless functions — it
can't host this Express server, since the server needs to stay running to
cache news and refresh every 15 minutes on a cron schedule. Split the two
pieces instead:

1. Deploy `backend/` to Render as described above (this stays your API +
   cron). Note the URL, e.g. `https://your-app.onrender.com`.
2. Open `backend/public/app.js` and set:
   ```js
   const API_BASE = "https://your-app.onrender.com";
   ```
3. On Netlify: New site from Git → point it at this repo →
   **Base directory**: `backend/public` → **Build command**: (leave blank,
   it's static) → **Publish directory**: `backend/public`.
4. Deploy. Netlify serves the frontend; it calls your Render backend for
   data. CORS is already open on the backend, so this works without further
   changes.

If you'd rather keep everything on one host, skip Netlify and just deploy
the whole `backend/` folder to Render (or Railway/Fly.io) as already
described — the frontend is served from the same server for free.

## Adding more sources or countries

Open `backend/data/sources.json` and add an object like:

```json
{
  "id": "example",
  "name": "Example News",
  "country": "Country Name",
  "countryCode": "XX",
  "feed": "https://example.com/rss.xml",
  "bias": "Center",
  "note": "Optional context shown as a tooltip."
}
```

No backend code changes needed — the frontend's country dropdown and bias
filter pick this up automatically.

## What this doesn't do (yet)

- No fact-checking layer or cross-source claim verification.
- No clustering of the "same story" across outlets — articles are just
  chronological, tagged by source and bias.
- Country filtering is by the outlet's home country, not per-article
  dateline — a UK outlet's story about France still shows under "United
  Kingdom."

These are reasonable next features if you want to extend it — happy to help
build any of them.
