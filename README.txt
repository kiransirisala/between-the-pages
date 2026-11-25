BETWEEN THE PAGES - Books OR Movies release candidate

FILES
- index.html
- style.css
- script.js
- worker.js

WHAT CHANGED
- The format selector has exactly two options: Books and Movies.
- There is no Both option or combined-results UI.
- The frontend always sends the selected format.
- The API rejects missing or invalid formats with HTTP 400; it does not silently default to Books.
- Books requests run only the book recommendation path (Groq situation analysis + Groq book evaluation, then book catalogue/provider requests).
- Movies requests run only the movie recommendation path (Groq situation analysis + Groq movie evaluation, then TMDB/Supabase movie requests).
- The unselected catalogue is not called.
- Existing language/origin filters, visual styling, and browser speech-input functionality are retained.

CLOUDFLARE WORKER VARIABLES / SECRETS EXPECTED
- GROQ_API_KEY (Secret)
- GOOGLE_BOOKS_API_KEY (Secret)
- TMDB_API_KEY (Secret; TMDB v3 API key, not the Read Access Token)
- SUPABASE_URL (Variable; project root URL, e.g. https://PROJECT_REF.supabase.co; no /rest/v1 suffix)
- SUPABASE_SECRET_KEY (Secret; keep server-side, never put in frontend or GitHub)

SUPABASE SCHEMA EXPECTED
public.books:
  google_books_id (unique), title, authors, description, categories, cover_url,
  info_link, isbn10, isbn13, language, published_date, country_of_origin
public.movies:
  tmdb_id (unique), title, overview, genres, poster_path, release_date,
  original_language, production_countries, spoken_languages

LOCAL TEST CHECKLIST
1. Keep the current production Worker and Pages deployment unchanged initially.
2. Test the frontend with a local static server (for example VS Code Live Server at http://127.0.0.1:5500).
3. Test/deploy worker.js to a separate test Worker or run it locally with the required secrets configured.
4. Confirm the Worker health endpoint reports Supabase and TMDB configured.
5. Submit a Books request. Confirm it returns only a book and that movie/TMDB discovery is not called.
6. Submit a Movies request. Confirm it returns only a movie and that Google Books discovery is not called.
7. Send requests with format=both, format missing, and an arbitrary format. Each must return HTTP 400 before any AI or catalogue calls.
8. Test language and country preferences for both content types. Remember: book country-of-origin filtering is best-effort because Google Books metadata is inconsistent; movie language means original language, not dubbed/subtitle availability.
9. Test the microphone in a supported browser and verify the transcript populates the situation field.
10. Only after all tests pass, deploy the Worker and publish the frontend.

IMPORTANT NOTES
- Each valid request is designed to make two Groq calls: one situation-analysis call and one candidate-evaluation call. Catalogue requests to Google Books/TMDB and Supabase are additional provider requests, not Groq calls.
- This package has passed JavaScript syntax checks only. It has NOT been tested against live Cloudflare, Groq, Google Books, Supabase or TMDB credentials. Do not deploy to production until the checklist passes.
- Login, per-user daily quotas, user history and admin analytics are not implemented in this package.
- TMDB API usage is subject to TMDB's non-commercial terms and attribution requirements. The page includes the attribution notice. Do not add advertising, subscriptions or revenue without first confirming the appropriate permission.
