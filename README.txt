BETWEEN THE PAGES - Books OR Movies MVP

PRODUCT
- The visitor chooses Books or Movies and describes a need or remembered story in natural language.
- The movie Worker internally classifies the request as remembered-title identification or mood/situation recommendation. The UI has no intent selector.
- The API returns one strongest verified recommendation or an honest no-match response.
- Language and country filters default to Any language and Anywhere.

PROJECT FILES
- index.html, style.css, script.js: Cloudflare Pages frontend.
- worker.js: Cloudflare Worker API and provider integrations.
- tests/worker-regression.mjs: network-free mocked Worker regression checks.

REQUEST FLOW
- The frontend POSTs situation, desiredOutcome, format, language, and country to /api/recommend.
- The Worker validates the JSON object, exact format, and supported filter values before provider calls.
- Books use Groq situation analysis, Google Books candidate search, Groq evaluation, and Google Books verification. Supabase is an optional cache; Open Library is discovery-only when no usable Google Books descriptions are available.
- Movies use Groq analysis with intent and plot-clue fields. Identification searches clue phrases and TMDB keyword/title results, verifies candidate details, and evaluates synopsis evidence with an identification prompt. It does not use the generic drama fallback.
- Mood/situation movie requests retain Supabase semantic retrieval and the TMDB popular-drama fallback. The shared weighted ranker and its existing rejection thresholds remain in place.
- Movie language matching accepts either original or spoken-language metadata. Movie country matching uses production-country metadata. Movie cache writes and embeddings are best-effort after a recommendation has been selected.
- Book language uses Google Books language restriction. Book country is included as a search hint only; Google Books country-of-origin data is inconsistent and is not verified as a hard filter.

WORKER CONFIGURATION
Required for recommendations:
- GROQ_API_KEY (Secret)
- GOOGLE_BOOKS_API_KEY (Secret; Books)
- TMDB_API_KEY (Secret; Movies; TMDB v3 API key)

Optional features:
- SUPABASE_URL (Variable; project root URL, without /rest/v1)
- SUPABASE_SECRET_KEY (Secret; server-side only)
- GEMINI_API_KEY (Secret; needed with Supabase for movie embedding search and writes)
- ADMIN_SYNC_KEY (Secret; protects the admin movie sync endpoint)

No secret values belong in this repository, README, browser code, or logs. The health endpoint reports whether selected integrations appear configured; that does not confirm credentials work or schemas match.

DATABASE NOTES
- The Worker reads and writes public.books and public.movies using the field names in worker.js.
- Movie semantic retrieval additionally expects a movie_embeddings table and a match_movies RPC compatible with gemini-embedding-001 embeddings configured to 1536 dimensions.
- This repository does not contain SQL migrations or the RPC definition. Confirm the actual database schema and vector dimensions before enabling semantic retrieval or catalogue sync. Do not infer or modify production schema based on this README.
- Book country-of-origin storage is not implemented as a verified filter.

LOCAL CHECKS
- Run the network-free regression suite with Node.js: node tests/worker-regression.mjs
- The suite mocks Groq, Google Books, TMDB, and Supabase responses. It checks format/body validation, Cast Away plot identification without drama fallback, retained mood fallback, spoken-language/country filtering, non-fatal movie cache writes, and Google Books continuation after Supabase cache failure.
- These mocked checks do not confirm live provider response formats, credentials, quotas, Cloudflare limits, Pages/Worker revision parity, production CORS settings, or Supabase schema compatibility.
- Before release, run the same scenarios against a separate test Worker and non-production credentials, then compare the deployed Pages and Worker revisions. Do not deploy or modify production data without explicit approval.

SECURITY AND LIMITS
- The frontend's Worker URL and allowed CORS origins are configured in script.js and worker.js respectively; verify both for each intended environment.
- No accounts, user history, per-user quota system, or admin analytics are implemented.
- TMDB attribution is displayed in the page. Confirm applicable TMDB terms before monetizing the service.
