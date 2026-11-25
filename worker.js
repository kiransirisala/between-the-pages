
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://between-the-pages.pages.dev"
];

const MODEL = "openai/gpt-oss-120b";
const MAX_SITUATION_LENGTH = 5000;
const MIN_DESCRIPTION_LENGTH = 80;
const MAX_CANDIDATES = 10;
const MAX_RANKED_CANDIDATES = 2;

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    situation_summary: { type: "string" },
    user_context: { type: "string" },
    main_challenge: { type: "string" },
    underlying_need: { type: "string" },
    desired_outcome: { type: "string" },
    search_queries: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "situation_summary",
    "user_context",
    "main_challenge",
    "underlying_need",
    "desired_outcome",
    "search_queries"
  ],
  additionalProperties: false
};

// Movie requests need to preserve concrete story clues as well as emotional
// context so remembered-title searches do not collapse into mood searches.
const MOVIE_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["identify", "recommend"] },
    situation_summary: { type: "string" },
    user_context: { type: "string" },
    main_challenge: { type: "string" },
    underlying_need: { type: "string" },
    desired_outcome: { type: "string" },
    plot_clues: { type: "array", items: { type: "string" } },
    search_queries: { type: "array", items: { type: "string" } }
  },
  required: ["intent", "situation_summary", "user_context", "main_challenge", "underlying_need", "desired_outcome", "plot_clues", "search_queries"],
  additionalProperties: false
};

const MOVIE_EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          situationScore: { type: "number" },
          practicalScore: { type: "number" },
          contextScore: { type: "number" },
          evidenceScore: { type: "number" },
          categoryScore: { type: "number" },
          reason: { type: "string" }
        },
        required: [
          "id",
          "situationScore",
          "practicalScore",
          "contextScore",
          "evidenceScore",
          "categoryScore",
          "reason"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["evaluations"],
  additionalProperties: false
};
const EVALUATION_SCHEMA = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          situationScore: { type: "number" },
          practicalScore: { type: "number" },
          contextScore: { type: "number" },
          evidenceScore: { type: "number" },
          categoryScore: { type: "number" },
          reason: { type: "string" }
        },
        required: [
          "id",
          "situationScore",
          "practicalScore",
          "contextScore",
          "evidenceScore",
          "categoryScore",
          "reason"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["evaluations"],
  additionalProperties: false
};


function jsonResponse(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    }
  });
}

function cleanString(value, maxLength = 5000) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function safeArray(value, max = 8) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const SUPPORTED_LANGUAGES = new Set(["any", "en", "te", "hi", "ta", "kn", "ml", "bn", "mr", "fr", "es", "de", "ja", "ko", "it", "pt", "zh"]);
const SUPPORTED_COUNTRIES = new Set(["IN", "US", "GB", "FR", "DE", "JP", "KR", "ES", "IT", "CA", "AU"]);
const COUNTRY_LABELS = { IN: "India", US: "United States", GB: "United Kingdom", FR: "France", DE: "Germany", JP: "Japan", KR: "South Korea", ES: "Spain", IT: "Italy", CA: "Canada", AU: "Australia" };

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function scoreValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < 0 || number > 5) return null;
  return number;
}

// --------------------------------------------------
// GROQ AI CONNECTION
// --------------------------------------------------


async function callGroq(env, messages, schema, maxTokens = 1200) {
  if (!env.GROQ_API_KEY) {
    throw new Error(
      "AI authentication failed: GROQ_API_KEY is not configured."
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;

  try {
    response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.2,
          max_completion_tokens: maxTokens,
          reasoning_effort: "low",
          include_reasoning: false,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schema === ANALYSIS_SCHEMA
                ? "situation_analysis"
                : schema === MOVIE_EVALUATION_SCHEMA
                  ? "movie_evaluation"
                  : schema === MOVIE_ANALYSIS_SCHEMA
                    ? "movie_analysis"
                    : "book_evaluation",
              strict: true,
              schema
            }
          }
        }),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("AI service timed out.");
    }

    throw new Error(`AI network error: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();

    console.error("Groq API error status:", response.status);

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "AI authentication failed. Check GROQ_API_KEY."
      );
    }

    if (response.status === 429) {
      throw new Error(
        "AI rate limit reached. Please try again shortly."
      );
    }

    if (response.status >= 500) {
      throw new Error(
        `AI service temporarily unavailable. HTTP ${response.status}.`
      );
    }

    throw new Error(
      `AI service returned ${response.status}.`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("AI service returned an empty response.");
  }

  try {
    return JSON.parse(content);
  } catch {
    console.error("Groq returned invalid JSON content.");

    throw new Error(
      "AI service returned an invalid response."
    );
  }
}


// --------------------------------------------------
// SUPABASE CATALOGUE HELPERS
// --------------------------------------------------

function supabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

async function supabaseRequest(env, table, method = "GET", query = "", body = null) {
  if (!supabaseConfigured(env)) return null;
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const url = `${base}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: {
      "apikey": env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=minimal"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Supabase request failed with status:", response.status);
    throw new Error(`Supabase catalogue returned ${response.status}.`);
  }
  if (method === "GET") return response.json();
  return true;
}

async function saveBookToSupabase(book, env) {
  if (!supabaseConfigured(env) || !book?.id) return;
  const row = {
    google_books_id: book.id,
    title: book.title,
    authors: book.authors || [],
    description: book.description || null,
    categories: book.categories || [],
    cover_url: book.thumbnail || null,
    info_link: book.infoLink || null,
    isbn10: book.isbn10 || null,
    isbn13: book.isbn13 || null,
    language: book.language || null,
    published_date: book.publishedDate || null
  };
  try {
    await supabaseRequest(env, "books", "POST", "on_conflict=google_books_id", [row]);
  } catch (error) {
    console.error("Could not cache book in Supabase:", errorMessage(error));
  }
}

async function saveMovieToSupabase(movie, env) {
  if (!supabaseConfigured(env) || !movie?.id) {
    throw new Error("Supabase is not configured or movie ID is missing.");
  }

  const row = {
    tmdb_id: Number(movie.id),
    title: movie.title,
    overview: movie.overview || null,
    genres: movie.genres || [],
    poster_path: movie.poster_path || null,
    release_date: movie.release_date || null,
    original_language: movie.original_language || null,
    production_countries: movie.production_countries || [],
    spoken_languages: movie.spoken_languages || []
  };

  await supabaseRequest(
    env,
    "movies",
    "POST",
    "on_conflict=tmdb_id",
    [row]
  );

  return true;
}


// --------------------------------------------------
// GEMINI EMBEDDINGS + SUPABASE VECTOR SEARCH
// --------------------------------------------------

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 1536;

async function createGeminiEmbedding(text, env, taskType) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini authentication failed: GEMINI_API_KEY is not configured.");
  }

  const input = cleanString(text, 7000);
  if (!input) {
    throw new Error("Cannot create an embedding from empty text.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: input }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error("Gemini embedding error status:", response.status);

    if (response.status === 401 || response.status === 403) {
      throw new Error("Gemini authentication failed. Check GEMINI_API_KEY.");
    }

    if (response.status === 429) {
      throw new Error("Gemini embedding rate limit reached.");
    }

    throw new Error(`Gemini embedding service returned ${response.status}.`);
  }

  const data = await response.json();
  const values = data.embedding?.values;

  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Gemini returned an invalid embedding dimension. Expected ${EMBEDDING_DIMENSIONS}.`
    );
  }

  // Normalize embeddings when using reduced dimensions.
  const norm = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0)
  );

  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("Gemini returned an invalid zero-length embedding.");
  }

  return values.map(value => value / norm);
}


async function saveMovieEmbedding(movie, env, existingEmbedding = null) {
  if (!supabaseConfigured(env)) {
    throw new Error("Supabase is not configured.");
  }

  if (!movie?.id || !movie?.overview) {
    throw new Error("Movie ID and synopsis are required.");
  }

  // Check whether this exact synopsis already has an embedding.
  const existing = await supabaseRequest(
    env,
    "movie_embeddings",
    "GET",
    `select=synopsis&tmdb_id=eq.${Number(movie.id)}&limit=1`
  );

  if (
    Array.isArray(existing) &&
    existing.length > 0 &&
    existing[0].synopsis === movie.overview
  ) {
    console.log("Movie embedding already exists. Skipping:", movie.id);
    return true;
  }

  // Reuse the embedding generated during semantic ranking.
  const embedding =
    Array.isArray(existingEmbedding) &&
    existingEmbedding.length === EMBEDDING_DIMENSIONS
      ? existingEmbedding
      : await createGeminiEmbedding(
          movie.overview,
          env,
          "RETRIEVAL_DOCUMENT"
        );

  if (
    !Array.isArray(embedding) ||
    embedding.length !== EMBEDDING_DIMENSIONS
  ) {
    throw new Error("Invalid movie embedding dimensions.");
  }

  await supabaseRequest(
    env,
    "movie_embeddings",
    "POST",
    "on_conflict=tmdb_id",
    [{
      tmdb_id: Number(movie.id),
      synopsis: movie.overview,
      embedding: `[${embedding.join(",")}]`
    }]
  );

  console.log("Movie embedding saved:", movie.id);

  return true;
}

 
async function searchMovieEmbeddings(situationText, env, matchCount = 40) {
  const embedding = await createGeminiEmbedding(
    situationText,
    env,
    "RETRIEVAL_QUERY"
  );

  const base = env.SUPABASE_URL.replace(/\/$/, "");

  const response = await fetch(
    `${base}/rest/v1/rpc/match_movies`,
    {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        query_embedding: `[${embedding.join(",")}]`,
        match_count: matchCount
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    console.error(
      "Supabase vector search failed:",
      response.status,
      detail.slice(0, 500)
    );

    throw new Error(
      `Supabase vector search returned ${response.status}.`
    );
  }

  const result = await response.json();

  if (!Array.isArray(result)) {
    throw new Error("Supabase vector search returned an invalid response.");
  }

  return result;
}



async function getMoviesByIds(ids, env) {
  const uniqueIds = [
    ...new Set(ids.map(Number).filter(Number.isFinite))
  ];

  if (!uniqueIds.length) return [];

  const params = new URLSearchParams({
    select: "tmdb_id,title,overview,genres,poster_path,release_date,original_language,production_countries,spoken_languages",
    tmdb_id: `in.(${uniqueIds.join(",")})`,
    limit: String(uniqueIds.length)
  });

  return (
    await supabaseRequest(
      env,
      "movies",
      "GET",
      params.toString()
    )
  ) || [];
}

// --------------------------------------------------
// GOOGLE BOOKS SEARCH
// --------------------------------------------------

async function searchGoogleBooks(query, env, language = "any") {
  if (!env.GOOGLE_BOOKS_API_KEY) {
    throw new Error("Google Books authentication failed: API key is not configured.");
  }

  const url = new URL(
    "https://www.googleapis.com/books/v1/volumes"
  );

  url.searchParams.set("q", query);
  const requestedLanguage = cleanString(language || "any", 12);
  if (requestedLanguage && requestedLanguage !== "any") {
    url.searchParams.set("langRestrict", requestedLanguage);
  }
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("printType", "books");
  url.searchParams.set("key", env.GOOGLE_BOOKS_API_KEY);

  let response;

  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    throw new Error(`Google Books network error: ${error.message}`);
  }

  if (!response.ok) {
    const detail = await response.text();

    console.error("Google Books search error status:", response.status);

    if (response.status === 401) {
      throw new Error("Google Books authentication failed. Check GOOGLE_BOOKS_API_KEY.");
    }

    if (response.status === 403 || response.status === 429) {
      throw new Error("Google Books quota or access limit reached.");
    }

    if (response.status >= 500) {
      throw new Error(`Google Books temporarily unavailable. HTTP ${response.status}.`);
    }

    throw new Error(`Google Books returned ${response.status}.`);
  }

  const data = await response.json();

  return (data.items || []).map(item => {
    const info = item.volumeInfo || {};
    const identifiers = info.industryIdentifiers || [];

    return {
      id: item.id,
      title: info.title || "",
      authors: safeArray(info.authors),
      description: cleanString(info.description, 3500),
      categories: safeArray(info.categories),
      publishedDate: info.publishedDate || null,
      language: info.language || null,
      publisher: info.publisher || null,
      thumbnail: info.imageLinks?.thumbnail || null,
      infoLink: info.infoLink || null,
      previewLink: info.previewLink || null,
      isbn13:
        identifiers.find(x => x.type === "ISBN_13")?.identifier || null,
      isbn10:
        identifiers.find(x => x.type === "ISBN_10")?.identifier || null,
      source: "Google Books"
    };
  }).filter(book =>
    book.id &&
    book.title &&
    book.authors.length
  );
}


// --------------------------------------------------
// VERIFY ORIGINAL GOOGLE BOOKS RECORD
// --------------------------------------------------


async function verifyGoogleBook(book, env) {
  if (!book?.id) {
    return null;
  }

  if (!env.GOOGLE_BOOKS_API_KEY) {
    throw new Error(
      "Google Books authentication failed: API key is not configured."
    );
  }

  const url = new URL(
  `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(book.id)}`
);

  url.searchParams.set("key", env.GOOGLE_BOOKS_API_KEY);

  let response;

  try {
    response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    throw new Error(
      `Google Books network error: ${error.message}`
    );
  }

  if (response.status === 404) {
    return null;
  }

  if (response.status === 401) {
    throw new Error(
      "Google Books authentication failed. Check GOOGLE_BOOKS_API_KEY."
    );
  }

  if (response.status === 403 || response.status === 429) {
    throw new Error(
      "Google Books quota or access limit reached."
    );
  }

  if (response.status >= 500) {
    throw new Error(
      `Google Books temporarily unavailable. HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Book verification returned ${response.status}.`
    );
  }

  const data = await response.json();
  const info = data.volumeInfo || {};
  const identifiers = info.industryIdentifiers || [];

  const isbn13 = identifiers.find(
    item => item.type === "ISBN_13"
  )?.identifier || null;

  const isbn10 = identifiers.find(
    item => item.type === "ISBN_10"
  )?.identifier || null;

  const title = cleanString(info.title, 300);

  const authors = Array.isArray(info.authors)
    ? info.authors.filter(
        name => typeof name === "string" && name.trim()
      )
    : [];

  const description = cleanString(info.description, 3500);

  // Diagnose original catalogue record failures.
const failedChecks = [];

if (data.id !== book.id) {
  failedChecks.push("ID mismatch");
}

if (!title) {
  failedChecks.push("Missing title");
}

if (!authors.length) {
  failedChecks.push("Missing authors");
}

if (description.length < MIN_DESCRIPTION_LENGTH) {
  failedChecks.push("Description too short");
}

if (failedChecks.length) {
  console.log("Book verification failed:", {
    id: book.id,
    candidateTitle: book.title,
    verifiedTitle: title,
    failedChecks
  });

  return null;
}

  // Ensure the verified title matches the search candidate.
  if (
  title.toLowerCase() !== book.title.trim().toLowerCase()
) {
  console.log("Book title mismatch:", {
    id: book.id,
    candidateTitle: book.title,
    verifiedTitle: title
  });

  return null;
}

const infoLink = info.infoLink;

if (!infoLink) {
  console.log("Missing Google Books infoLink:", book.id);
  return null;
}

  try {
    const parsed = new URL(infoLink);

    if (
      parsed.protocol !== "https:" ||
      !["books.google.com", "play.google.com"].includes(parsed.hostname)
    ) {

    console.log("Invalid Google Books infoLink:", infoLink);
      return null;
    }
  } catch {
    return null;
  }

  return {
    id: data.id,
    title,
    authors,
    description,
    categories: safeArray(info.categories),
    publishedDate: info.publishedDate || null,
    language: info.language || null,
    publisher: info.publisher || null,
    thumbnail: info.imageLinks?.thumbnail || null,
    infoLink,
    previewLink: info.previewLink || null,
    isbn13,
    isbn10,
    source: "Google Books"
  };
}


// --------------------------------------------------
// OPEN LIBRARY DISCOVERY FALLBACK
// This is discovery only, not verification.
// --------------------------------------------------

async function searchOpenLibrary(query) {
  const url = new URL("https://openlibrary.org/search.json");

  url.searchParams.set(
    "q",
    `${query} AND language:eng`
  );

  url.searchParams.set("limit", "10");

  url.searchParams.set(
    "fields",
    "key,title,author_name,first_publish_year,edition_count,cover_i,subject,first_sentence"
  );

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "User-Agent": "BetweenThePages/0.3 (book discovery prototype)"
    }
  });

  if (!response.ok) {
    throw new Error(`Open Library returned ${response.status}.`);
  }

  const data = await response.json();

  return (data.docs || []).map(book => ({
    id: book.key,
    title: book.title || "",
    authors: book.author_name || [],
    description: Array.isArray(book.first_sentence)
      ? String(book.first_sentence[0] || "").slice(0, 500)
      : String(book.first_sentence || "").slice(0, 500),
    categories: safeArray(book.subject),
    publishedDate: book.first_publish_year
      ? String(book.first_publish_year)
      : null,
    thumbnail: book.cover_i
      ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`
      : null,
    infoLink: book.key
      ? `https://openlibrary.org${book.key}`
      : null,
    previewLink: null,
    source: "Open Library"
  })).filter(book =>
    book.id && book.title && book.authors.length
  );
}

// --------------------------------------------------
// STEP 1: UNDERSTAND THE USER'S SITUATION
// --------------------------------------------------

async function analyseSituation(situation, desiredOutcome, env, language = "any", country = "") {
  const analysis = await callGroq(env, [
    {
      role: "system",
      content: `You are the situation-understanding engine for Between the Pages.

Understand the user's actual circumstances, profession, interests, challenge, underlying need and desired outcome.

Do not rely on simple keyword matching.

Generate three distinct, concise search queries for relevant books. Respect the requested content language and country preference.

Queries should explore different but relevant angles of the same problem.

Example:
A magician who wants to make audiences laugh may need:
- comedy writing and joke construction
- comedic timing and improvisation
- stage performance and audience engagement

Do not default to generic productivity or self-help books.

Return only JSON:

{
  "situation_summary": "...",
  "user_context": "...",
  "main_challenge": "...",
  "underlying_need": "...",
  "desired_outcome": "...",
  "search_queries": [
    "short targeted query 1",
    "short targeted query 2",
    "short targeted query 3"
  ]
}

Do not invent facts about the user.`
    },
    {
      role: "user",
      content: JSON.stringify({ situation, desired_outcome: desiredOutcome, preferred_language: language, preferred_country: country || "any" })
    }
  ], ANALYSIS_SCHEMA, 1200);

  if (
    !analysis ||
    typeof analysis !== "object" ||
    !Array.isArray(analysis.search_queries)
  ) {
    throw new Error(
      "AI situation analysis returned an invalid structure."
    );
  }

  return analysis;
}

// --------------------------------------------------
// STEP 2: SEARCH AND COLLECT CANDIDATES
// --------------------------------------------------

async function findCachedBooks(query, env, language = "any") {
  if (!supabaseConfigured(env)) return [];
  const terms = cleanString(query, 120).split(/\s+/).filter(x => x.length > 3).slice(0, 3);
  if (!terms.length) return [];
  const pattern = `*${terms[0].replace(/[,*()]/g, "")}*`;
  const params = new URLSearchParams({
    select: "google_books_id,title,authors,description,categories,cover_url,info_link,isbn10,isbn13,language,published_date",
    title: `ilike.${pattern}`,
    limit: "5"
  });
  if (language && language !== "any") params.set("language", `eq.${language}`);
  const rows = await supabaseRequest(env, "books", "GET", params.toString());
  return (rows || []).map(row => ({
    id: row.google_books_id, title: row.title, authors: row.authors || [],
    description: row.description || "", categories: row.categories || [],
    thumbnail: row.cover_url, infoLink: row.info_link, previewLink: null,
    isbn10: row.isbn10, isbn13: row.isbn13, language: row.language,
    publishedDate: row.published_date, source: "Supabase catalogue"
  })).filter(book => book.id && book.description.length >= MIN_DESCRIPTION_LENGTH);
}

async function collectCandidates(queries, env, language = "any") {
  const uniqueBooks = new Map();
  const searchErrors = [];

  for (const rawQuery of queries.slice(0, 3)) {
    const query = cleanString(rawQuery, 120);
    if (!query) continue;

    try {
      const cachedBooks = await findCachedBooks(query, env, language);
      for (const book of cachedBooks) {
        if (!uniqueBooks.has(book.id)) uniqueBooks.set(book.id, book);
      }
    } catch (error) {
      console.error("Supabase book cache lookup failed; continuing with Google Books:", errorMessage(error));
    }

    try {
      const books = uniqueBooks.size >= MAX_RANKED_CANDIDATES
        ? []
        : await searchGoogleBooks(query, env, language);

      for (const book of books) {
        if (
          !book.description ||
          book.description.length < MIN_DESCRIPTION_LENGTH
        ) {
          continue;
        }

        if (!uniqueBooks.has(book.id)) {
          uniqueBooks.set(book.id, book);
        }
      }
    } catch (error) {
      searchErrors.push(errorMessage(error));

      console.error(
        "Google Books search failed:",
        errorMessage(error)
      );
    }
  }

  return {
    candidates: Array.from(uniqueBooks.values()).slice(
      0,
      MAX_CANDIDATES
    ),
    searchErrors
  };
}

// --------------------------------------------------
// STEP 3: WEIGHTED RELEVANCE EVALUATION
// --------------------------------------------------

async function evaluateCandidates(
  analysis,
  desiredOutcome,
  candidates,
  env
) {
  const selection = await callGroq(env, [
    {
      role: "system",
      content: `You are the evidence-based book evaluation engine for Between the Pages.

Your task is to evaluate candidate books against the user's actual situation.

Read each book description carefully. Do not select based on title keywords, popularity, or broad category alone.

Score each candidate from 0 to 5 on these five criteria:

1. situationScore (weight 35%)
Does the described content directly address the user's specific situation and challenge?

2. practicalScore (weight 25%)
Does the description show practical techniques, exercises, frameworks, examples or useful guidance?

3. contextScore (weight 20%)
Does the content fit the user's profession, circumstances, interests or life context?

4. evidenceScore (weight 15%)
Is the match clearly supported by the actual book description, rather than assumptions?

5. categoryScore (weight 5%)
Does the book's catalogue category support the intended subject?

SCORING GUIDANCE:
0 = no match
1 = very weak match
2 = partial match
3 = reasonable match
4 = strong match
5 = exceptionally direct match

IMPORTANT:
- A generic self-help book should not score highly just because the user has a problem.
- A book about a neighbouring topic is not necessarily a good match.
- Never infer practical content that is not supported by the description.
- Do not invent book content.
- Do not reward popularity or publication date.
- Do not include weak or unrelated candidates.

Return no more than two candidates, strongest first.

Only use IDs provided in the candidate list.

Return only JSON:

{
  "evaluations": [
    {
      "id": "exact candidate ID",
      "situationScore": 5,
      "practicalScore": 4,
      "contextScore": 5,
      "evidenceScore": 5,
      "categoryScore": 4,
      "reason": "Explain the specific connection between the user's situation and the described book content."
    }
  ]
}

All five scores must be numeric values from 0 to 5.
If no candidate is a sufficiently relevant match, return an empty evaluations array.`
    },
    {
      role: "user",
      content: JSON.stringify({
        userSituation: analysis,
        desiredOutcome,
        candidates: candidates.map(book => ({
          id: book.id,
          title: book.title,
          authors: book.authors,
          description: book.description,
          categories: book.categories,
          publishedDate: book.publishedDate
        }))
      })
    }
  ], EVALUATION_SCHEMA, 1800);

  return selection;
}

// --------------------------------------------------
// STEP 4: CALCULATE WEIGHTED SCORE
// --------------------------------------------------

function rankCandidates(selection, candidates) {
  const evaluations = Array.isArray(selection?.evaluations)
    ? selection.evaluations
    : [];

  if (!evaluations.length) {
    console.error(
      "AI evaluation returned no usable candidates:",
      JSON.stringify(selection)
    );
  }

  const ranked = [];

  for (const evaluation of evaluations) {
    if (
      !evaluation ||
      typeof evaluation.id !== "string"
    ) {
      continue;
    }

    const book = candidates.find(
      item => item.id === evaluation.id
    );

    if (!book) continue;

    const situation = scoreValue(evaluation.situationScore);
    const practical = scoreValue(evaluation.practicalScore);
    const context = scoreValue(evaluation.contextScore);
    const evidence = scoreValue(evaluation.evidenceScore);
    const category = scoreValue(evaluation.categoryScore);

    if (
      situation === null ||
      practical === null ||
      context === null ||
      evidence === null ||
      category === null
    ) {
      continue;
    }

    // Maximum score = 100.
    const totalScore =
      situation * 7 +
      practical * 5 +
      context * 4 +
      evidence * 3 +
      category * 1;

    // Reject weak direct matches and unsupported evidence.
    if (
      situation < 3 ||
      evidence < 3 ||
      totalScore < 65
    ) {
      continue;
    }

    ranked.push({
      book,
      totalScore,
      situationScore: situation,
      practicalScore: practical,
      contextScore: context,
      evidenceScore: evidence,
      categoryScore: category,
      reason: cleanString(evaluation.reason, 1200)
    });
  }

  ranked.sort((a, b) => b.totalScore - a.totalScore);

  return ranked.slice(0, MAX_RANKED_CANDIDATES);
}

// --------------------------------------------------
// STEP 5: VERIFY RANKED BOOKS
// --------------------------------------------------

async function findVerifiedRecommendation(ranked, env) {
  let verificationErrors = 0;
  let attempted = 0;

  for (const candidate of ranked) {
    attempted++;

    try {
      const verified = candidate.book.source === "Supabase catalogue"
        ? candidate.book
        : await verifyGoogleBook(candidate.book, env);

      if (!verified) {
        console.log(
          "Candidate did not pass verification:",
          candidate.book.id
        );
        continue;
      }

      console.log(
        "Verified recommendation selected:",
        verified.title,
        "Score:",
        candidate.totalScore
      );

      await saveBookToSupabase({ ...verified, language: verified.language }, env);

      return {
        book: verified,
        reason: candidate.reason,
        relevanceScore: candidate.totalScore,
        scoreBreakdown: {
          situation: candidate.situationScore,
          practicalUsefulness: candidate.practicalScore,
          professionalContext: candidate.contextScore,
          descriptionEvidence: candidate.evidenceScore,
          category: candidate.categoryScore
        },
        verificationErrors,
        attempted
      };

    
} catch (error) {
  const message = errorMessage(error);

  console.error(
    "Candidate verification error:",
    candidate.book.id,
    message
  );

  // API failures must reach the main error handler.
  // Ordinary candidate errors should allow the next book to be checked.
  
const isServiceError =
  /Google Books returned (?!404\b)\d{3}|Book verification returned (?!404\b)\d{3}|Google Books authentication failed|quota|access limit|temporarily unavailable|network error|timed out/i.test(message);

  if (isServiceError) {
    throw error;
  }

  verificationErrors++;

  // Continue to the next ranked candidate.
    }
  }

  return {
    book: null,
    verificationErrors,
    attempted
  };
}

// --------------------------------------------------

// --------------------------------------------------
// TMDB MOVIE DISCOVERY AND RECOMMENDATION
// --------------------------------------------------

async function tmdbFetch(path, env, params = {}) {
  if (!env.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is not configured.");
  }

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", env.TMDB_API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("TMDB API error status:", response.status);

    if (response.status === 401) {
      throw new Error("TMDB authentication failed. Check TMDB_API_KEY.");
    }

    if (response.status === 429) {
      throw new Error("TMDB rate limit reached.");
    }

    throw new Error(`TMDB service returned ${response.status}.`);
  }

  return response.json();
}


// Search TMDB's keyword catalogue rather than treating
// natural-language situations as movie titles.
async function searchMovieKeywords(query, env) {
  const data = await tmdbFetch("/search/keyword", env, {
    query,
    page: 1
  });

  return (data.results || [])
    .filter(item => item.id && item.name)
    .slice(0, 3);
}


// Fetch movie details and retain the original catalogue metadata.
async function enrichAndVerifyMovie(candidate, env, language = "en-US") {
  const data = await tmdbFetch(
    `/movie/${encodeURIComponent(candidate.id)}`,
    env,
    { language }
  );

  const title = cleanString(data.title || data.original_title, 300);
  const overview = cleanString(data.overview, 3500);

  if (
    !title ||
    !overview ||
    overview.length < 50 ||
    String(data.id) !== candidate.id
  ) {
    return null;
  }

  return {
    id: String(data.id),
    title,
    overview,
    release_date: data.release_date || null,
    original_language: data.original_language || null,
    poster_path: data.poster_path
      ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
      : null,
    genres: (data.genres || []).map(x => x.name).filter(Boolean),
    production_countries: (data.production_countries || [])
      .map(x => x.iso_3166_1)
      .filter(Boolean),
    spoken_languages: (data.spoken_languages || [])
      .map(x => x.iso_639_1)
      .filter(Boolean),
    source: "TMDB",
    tmdb_url: `https://www.themoviedb.org/movie/${data.id}`
  };
}


// Collect movie candidates from:
// 1. Supabase cache
// 2. TMDB keyword search + discovery
// 3. A short-title-search fallback
async function discoverMovieCandidates(
  queries,
  env,
  intent = "recommend",
  plotClues = []
) {
  const found = new Map();
  const discoveryQueries = intent === "identify"
    ? [...plotClues, ...queries]
    : queries;

  const addMovie = (item, source = "TMDB") => {
    if (!item?.id || !item.overview || item.overview.length < 50) {
      return;
    }
 
    const id = String(item.id);

    if (!found.has(id)) {
      found.set(id, {
        id,
        title: item.title || item.original_title || "",
        overview: cleanString(item.overview, 3500),
        release_date: item.release_date || null,
        original_language: item.original_language || null,
        poster_path: item.poster_path
          ? item.poster_path.startsWith("http")
            ? item.poster_path
            : `https://image.tmdb.org/t/p/w500${item.poster_path}`
          : null,
        genres: item.genres || [],
        production_countries: item.production_countries || [],
        spoken_languages: item.spoken_languages || [],
        source,
        tmdb_url: `https://www.themoviedb.org/movie/${id}`
      });
    }
  };

  // 1. Search the existing Supabase movie catalogue.
  if (supabaseConfigured(env)) {
    try {
      const terms = discoveryQueries
        .flatMap(q => cleanString(q, 120).split(/\s+/))
        .map(x => x.replace(/[,*()]/g, ""))
        .filter(x => x.length > 4)
        .slice(0, 3);

      if (terms.length) {
        const params = new URLSearchParams({
          select: "tmdb_id,title,overview,genres,poster_path,release_date,original_language,production_countries,spoken_languages",
          or: `(${terms.map(term => `title.ilike.*${term}*`).join(",")})`,
          limit: "10"
        });

        const cached = await supabaseRequest(
          env,
          "movies",
          "GET",
          params.toString()
        );

        for (const row of cached || []) {
          addMovie({
            id: row.tmdb_id,
            title: row.title,
            overview: row.overview || "",
            genres: row.genres || [],
            poster_path: row.poster_path,
            release_date: row.release_date,
            original_language: row.original_language,
            production_countries: row.production_countries || [],
            spoken_languages: row.spoken_languages || []
          }, "Supabase catalogue");
        }
      }

      console.log("Movie discovery: Supabase candidates", found.size);
    } catch (error) {
      console.error(
        "Supabase movie cache lookup failed:",
        errorMessage(error)
      );
    }
  }

  // Search distinctive clue phrases independently. Broad natural-language
  // paragraphs are poor keyword queries and can return unrelated keyword IDs.
  const keywordIds = new Set();
  const clueQueries = intent === "identify"
    ? [...new Set([...plotClues, ...queries].map(q => cleanString(q, 120)).filter(Boolean))].slice(0, 4)
    : queries.slice(0, 3);

  for (const query of clueQueries) {
    try {
      const keywords = await searchMovieKeywords(query, env);

      for (const keyword of keywords) {
        keywordIds.add(String(keyword.id));
      }
    } catch (error) {
      console.error(
        "TMDB keyword search failed:",
        errorMessage(error)
      );
    }
  }

  console.log(
    "Movie discovery: TMDB keyword IDs found",
    keywordIds.size
  );

  if (keywordIds.size) {
    const ids = Array.from(keywordIds).slice(0, 10);
    try {
      const params = {
        include_adult: "false",
        language: "en-US",
        sort_by: "popularity.desc",
        page: 1,
        // TMDB uses pipe for OR, so remembered plots can match any clue.
        with_keywords: ids.join(intent === "identify" ? "|" : ",")
      };

      const discovered = await tmdbFetch(
        "/discover/movie",
        env,
        params
      );

      console.log(
        "Movie discovery: TMDB discover results",
        (discovered.results || []).length
      );

      for (const item of discovered.results || []) {
        addMovie(item);
      }
    } catch (error) {
      console.error(
        "TMDB movie discovery failed:",
        errorMessage(error)
      );
    }
  }

  // Mood discovery retains its broad discovery fallback. A remembered-plot
  // request must never be filled with unrelated popular dramas.
  if (intent !== "identify" && found.size < 5) {
    for (let page = 1; page <= 3; page++) {
      try {
        const discovered = await tmdbFetch(
          "/discover/movie",
          env,
          {
            include_adult: "false",
            language: "en-US",
            sort_by: "vote_count.desc",
            "vote_count.gte": 50,
            with_genres: "18",
            page
          }
        );

        console.log(
          "Movie discovery: TMDB drama fallback page",
          page,
          (discovered.results || []).length
        );

        for (const item of discovered.results || []) {
          addMovie(item);
        }
      } catch (error) {
        console.error(
          "TMDB drama fallback failed:",
          errorMessage(error)
        );
      }

      if (found.size >= 20) break;
    }
  }

  // 4. Fallback: use shorter phrases in title search.
  // This avoids sending long situation descriptions as movie titles.
  if (intent === "identify" || found.size < MAX_RANKED_CANDIDATES) {
    const titleQueries = intent === "identify" ? [...queries, ...plotClues] : queries.slice(0, 3);
    for (const query of titleQueries.slice(0, intent === "identify" ? 4 : 3)) {
      const shortQuery = cleanString(query, 120)
        .replace(/\b(movies?|films?|about|that|which|illustrate|stories|characters)\b/gi, "")
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(" ");

      if (!shortQuery) continue;

      try {
        const data = await tmdbFetch("/search/movie", env, {
          query: shortQuery,
          include_adult: "false",
          language: "en-US",
          page: 1
        });

        console.log(
          "Movie discovery: TMDB title search results",
          shortQuery,
          (data.results || []).length
        );

        for (const item of data.results || []) {
          addMovie(item);
        }
      } catch (error) {
        console.error(
          "TMDB title search failed:",
          errorMessage(error)
        );
      }

      if (found.size >= MAX_CANDIDATES) break;
    }
  }

  const candidates = Array.from(found.values()).slice(
    0,
    MAX_CANDIDATES
  );

  console.log(
    "Movie discovery: final candidate count",
    candidates.length
  );

  return candidates;
}


// --------------------------------------------------
// TMDB MOVIE CATALOGUE SYNC
// --------------------------------------------------

async function syncMovieCataloguePage(body, env) {
  const allowedLists = [
    "popular",
    "top_rated",
    "now_playing",
    "upcoming"
  ];

  const list = cleanString(body.list || "popular", 30);

  if (!allowedLists.includes(list)) {
    throw new Error(
      "Invalid movie list. Use popular, top_rated, now_playing or upcoming."
    );
  }

  const page = Math.max(
    1,
    Math.min(500, Number(body.page) || 1)
  );

  const startIndex = Math.max(
    0,
    Math.min(19, Number(body.startIndex) || 0)
  );

  const language = cleanString(
    body.language || "en-US",
    12
  );

  const region = cleanString(
    body.region || "",
    5
  ).toUpperCase();

  // Fetch the selected TMDB catalogue page.
  const data = await tmdbFetch(
    `/movie/${list}`,
    env,
    {
      language,
      region: region || undefined,
      page
    }
  );

  const movies = (data.results || []).slice(
    startIndex,
    startIndex + 5
  );

  if (!movies.length) {
    return {
      success: true,
      message: "No more movies were found in this catalogue page.",
      list,
      page,
      startIndex,
      processed: 0,
      saved: 0,
      failed: 0,
      nextPage: page + 1,
      nextStartIndex: 0
    };
  }

  let saved = 0;
  let failed = 0;
  const errors = [];

  // Process a small number concurrently to reduce timeouts.
  let currentIndex = 0;

  async function processMovie(movie) {
    try {
      const verified = await enrichAndVerifyMovie(
        { id: String(movie.id) },
        env,
        language
      );

      if (!verified) {
        throw new Error(
          "TMDB did not return a sufficiently detailed movie synopsis."
        );
      }

      await saveMovieToSupabase(verified, env);
      await saveMovieEmbedding(verified, env);

      saved++;

    } catch (error) {
      failed++;

      errors.push({
        tmdbId: movie.id,
        title: movie.title || movie.original_title || "",
        error: errorMessage(error)
      });

      console.error(
        "Movie catalogue sync failed:",
        movie.id,
        errorMessage(error)
      );
    }
  }

  async function worker() {
    while (currentIndex < movies.length) {
      const index = currentIndex++;
      await processMovie(movies[index]);
    }
  }

  await Promise.all([
    worker(),
    worker()
  ]);

  const nextStartIndex = startIndex + movies.length;
  const pageComplete = nextStartIndex >= (data.results || []).length;

  return {
    success: failed === 0,
    list,
    language,
    region: region || null,
    page,
    processed: movies.length,
    saved,
    failed,
    errors,
    nextPage: pageComplete ? page + 1 : page,
    nextStartIndex: pageComplete ? 0 : nextStartIndex,
    totalPages: data.total_pages || null,
    totalResults: data.total_results || null
  };
}


async function evaluateMovieCandidates(
  situation,
  analysis,
  desiredOutcome,
  candidates,
  env
) {
  if (!candidates.length) {
    return [];
  }

  const selection = await callGroq(env, [
    {
      role: "system",
      content: analysis?.intent === "identify"
        ? `You identify a remembered movie using evidence from its actual synopsis.

Treat the user's remembered plot and listed clues as evidence to verify, not as themes for a recommendation. Compare characters and relationships, events, setting, objects, distinctive scenes, and story progression. Alternate wording is acceptable, but the synopsis must support several distinctive clues. Do not identify a title from one generic overlap, genre, popularity, or a guessed plot. If evidence is insufficient, return an empty evaluations array.

Score from 0 to 5. situationScore measures direct plot correspondence; evidenceScore measures whether distinctive clues are supported by the synopsis. The other scores are secondary and must not reward mood fit alone. Give a concise reason tied to explicit synopsis evidence. Only use exact candidate IDs, return at most two, and return JSON matching the supplied schema.`
        : `You are an evidence-based movie matching engine.

Evaluate each movie's actual synopsis against the user's situation and desired emotional outcome.

Score each movie from 0 to 5:
- situationScore (35%)
- practicalScore (25%)
- contextScore (20%)
- evidenceScore (15%)
- categoryScore (5%)

Use the actual synopsis as evidence.
Do not select based on title keywords, popularity or similarity alone.
Do not invent movie content.
Only use the exact candidate IDs provided.
Return no more than two candidates, strongest first.

If no movie is sufficiently relevant, return an empty evaluations array.

Return JSON with:
id, situationScore, practicalScore, contextScore,
evidenceScore, categoryScore and reason.`
    },
    {
      role: "user",
      content: JSON.stringify({
        userSituation: {
          situation,
          analysis,
          desiredOutcome
        },
        candidates: candidates.map(movie => ({
          id: movie.id,
          title: movie.title,
          overview: movie.overview,
          genres: movie.genres,
          release_date: movie.release_date,
          original_language: movie.original_language
        }))
      })
    }
  ], MOVIE_EVALUATION_SCHEMA, 1500);

  if (!selection || typeof selection !== "object" || !Array.isArray(selection.evaluations)) {
    throw new Error("AI movie evaluation returned an invalid response structure.");
  }

  const rankingCandidates = candidates.map(movie => ({
    ...movie,
    authors: [],
    description: movie.overview,
    categories: movie.genres,
    publishedDate: movie.release_date
  }));

  return rankCandidates(selection, rankingCandidates);
}


async function recommendMovies(body, env) {
  const situation = cleanString(
    body.situation,
    MAX_SITUATION_LENGTH
  );

  const desiredOutcome = cleanString(
    body.desiredOutcome,
    200
  ) || "surprise me";

  const language = cleanString(
    body.language || "any",
    12
  ).toLowerCase();

  const country = cleanString(
    body.country || "",
    2
  ).toUpperCase();

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return { success: false, error: "Please choose a supported language or Any language." };
  }
  if (country && !SUPPORTED_COUNTRIES.has(country)) {
    return { success: false, error: "Please choose a valid two-letter country code." };
  }

  if (!situation || situation.length < 10) {
    return {
      success: false,
      error: "Please describe your situation in at least 10 characters."
    };
  }

  // STEP 1: Understand the user's situation.
  const analysis = await callGroq(env, [
    {
      role: "system",
      content: `You are the movie request analysis engine for Between the Pages.

First classify the request as identify when the user is trying to remember a movie from its plot, scene, character, object or other clues; otherwise classify it as recommend (mood, interests, life situation, or desired emotional outcome).

For identify requests, extract up to eight short, concrete clues: characters and relationships, events, setting, objects, distinctive scenes and story progression. Preserve details from the user's wording; do not invent. Generate up to six concise searches that preserve distinctive combinations and useful alternate wording. Avoid replacing the plot with generic genre or mood themes.

For recommend requests, identify emotional/narrative needs and generate three focused thematic searches. Keep plot_clues empty unless the user is recalling an existing movie.

Do not invent facts. Return all fields required by the supplied schema.`
    },
    {
      role: "user",
      content: JSON.stringify({
        situation,
        desired_outcome: desiredOutcome,
        preferred_language: language,
        preferred_country: country || "any"
      })
    }
  ], MOVIE_ANALYSIS_SCHEMA, 1200);

  if (
    !analysis ||
    typeof analysis !== "object" ||
    !["identify", "recommend"].includes(analysis.intent) ||
    !Array.isArray(analysis.plot_clues) ||
    !Array.isArray(analysis.search_queries)
  ) {
    throw new Error("AI movie analysis returned an invalid response structure.");
  }

  const intent = analysis.intent === "identify" ? "identify" : "recommend";
  const plotClues = safeArray(analysis.plot_clues, 8)
    .map(clue => cleanString(clue, 120))
    .filter(Boolean);
  const queries = (analysis.search_queries || [])
    .map(query => cleanString(query, 120))
    .filter(Boolean)
    .slice(0, intent === "identify" ? 6 : 3);

  // STEP 2: Try the existing Supabase semantic catalogue.
  let semanticCandidates = [];

  try {
    const semanticQuery = [
      situation,
      analysis.situation_summary,
      analysis.user_context,
      analysis.main_challenge,
      analysis.underlying_need,
      analysis.desired_outcome,
      desiredOutcome,
      ...queries
    ].filter(Boolean).join("\n");

    const matches = await searchMovieEmbeddings(
      semanticQuery,
      env,
      150
    );

    if (matches.length) {
      const movies = await getMoviesByIds(
        matches.map(match => match.tmdb_id),
        env
      );

      const similarityById = new Map(
        matches.map(match => [
          String(match.tmdb_id),
          Number(match.similarity)
        ])
      );

      semanticCandidates = movies.map(movie => ({
        id: String(movie.tmdb_id),
        title: movie.title,
        overview: movie.overview || "",
        genres: movie.genres || [],
        poster_path: movie.poster_path || null,
        release_date: movie.release_date || null,
        original_language: movie.original_language || null,
        production_countries: movie.production_countries || [],
        spoken_languages: movie.spoken_languages || [],
        similarity: similarityById.get(String(movie.tmdb_id)) || 0,
        source: "Supabase catalogue"
      })).filter(movie =>
        movie.title &&
        movie.overview &&
        movie.overview.length >= 50
      );

      if (language !== "any") {
        const languageCode = language.split("-")[0];

        semanticCandidates = semanticCandidates.filter(movie =>
          movie.original_language === languageCode ||
          movie.spoken_languages.includes(languageCode)
        );
      }

      if (country) {
        semanticCandidates = semanticCandidates.filter(movie =>
          movie.production_countries.some(
            code => String(code).toUpperCase() === country
          )
        );
      }

      semanticCandidates.sort(
        (a, b) => b.similarity - a.similarity
      );

      semanticCandidates = semanticCandidates.slice(
        0,
        MAX_CANDIDATES
      );
    }
  } catch (error) {
    console.error(
      "Supabase semantic movie search failed:",
      errorMessage(error)
    );
  }

  console.log(
    "Movie recommendation: Supabase candidates",
    semanticCandidates.length
  );

  // STEP 3: Evaluate Supabase candidates first.
  let ranked = [];

  if (semanticCandidates.length && intent !== "identify") {
    ranked = await evaluateMovieCandidates(
      situation,
      analysis,
      desiredOutcome,
      semanticCandidates,
      env
    );
  }

  console.log(
    "Movie recommendation: Supabase strong matches",
    ranked.length
  );

  // STEP 4: If no strong match exists, discover movies live from TMDB.
  let movieCandidatesEvaluated = semanticCandidates.length;
  if (!ranked.length || intent === "identify") {
    console.log(
      "Movie recommendation: starting live TMDB discovery"
    );

    const discovered = await discoverMovieCandidates(
      queries,
      env,
      intent,
      plotClues
    );

    console.log(
      "Movie recommendation: TMDB discovered candidates",
      discovered.length
    );

    // Fetch full movie details and actual synopses.
    const detailResults = await Promise.all(
      discovered.slice(0, 8).map(async candidate => {
        try {
          return await enrichAndVerifyMovie(
            candidate,
            env,
            "en-US"
          );
        } catch (error) {
          console.error(
            "TMDB movie detail lookup failed:",
            candidate.id,
            errorMessage(error)
          );
          return null;
        }
      })
    );

    let liveCandidates = detailResults.filter(Boolean);

    // Apply language preference using full movie details.
    if (language !== "any") {
      const languageCode = language.split("-")[0];

      liveCandidates = liveCandidates.filter(movie =>
        movie.original_language === languageCode ||
        movie.spoken_languages.includes(languageCode)
      );
    }

    // Apply production-country preference.
    if (country) {
      liveCandidates = liveCandidates.filter(movie =>
        movie.production_countries.some(
          code => String(code).toUpperCase() === country
        )
      );
    }

    console.log(
      "Movie recommendation: verified TMDB details",
      liveCandidates.length
    );
    const evaluationCandidates = intent === "identify"
      ? Array.from(new Map([...liveCandidates, ...semanticCandidates].map(movie => [String(movie.id), movie])).values()).slice(0, MAX_CANDIDATES)
      : liveCandidates;
    movieCandidatesEvaluated = intent === "identify"
      ? evaluationCandidates.length
      : movieCandidatesEvaluated + liveCandidates.length;

    if (evaluationCandidates.length) {
      ranked = await evaluateMovieCandidates(
        situation,
        analysis,
        desiredOutcome,
        evaluationCandidates,
        env
      );
    }
  }

  // STEP 5: Return no recommendation rather than an unrelated movie.
  if (!ranked.length) {
    return {
      success: true,
      analysis,
      candidatesEvaluated: movieCandidatesEvaluated,
      recommendation: null,
      message: "We searched the stored movie catalogue and attempted live TMDB discovery, but couldn't find a sufficiently relevant movie. Please try describing your situation differently."
    };
  }

  // STEP 6: Return exactly one strongest recommendation.
  const item = ranked[0];
  const movie = item.book;

  const posterPath = movie.poster_path
    ? movie.poster_path.startsWith("http")
      ? movie.poster_path
      : `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : null;

  // Cache the selected movie and its synopsis embedding.
  try {
    await saveMovieToSupabase(movie, env);
    await saveMovieEmbedding(movie, env);
  } catch (error) {
    console.error("Movie cache/embedding write failed; returning verified recommendation:", errorMessage(error));
  }

  return {
    success: true,
    analysis,
    candidatesEvaluated: movieCandidatesEvaluated,
    recommendation: {
      id: movie.id,
      title: movie.title,
      overview: movie.overview,
      genres: movie.genres,
      poster_path: posterPath,
      release_date: movie.release_date,
      original_language: movie.original_language,
      production_countries: movie.production_countries,
      spoken_languages: movie.spoken_languages,
      source: "TMDB",
      tmdb_url: `https://www.themoviedb.org/movie/${movie.id}`,
      reason: item.reason,
      relevanceScore: item.totalScore,
      scoreBreakdown: {
        situation: item.situationScore,
        practicalUsefulness: item.practicalScore,
        professionalContext: item.contextScore,
        descriptionEvidence: item.evidenceScore,
        category: item.categoryScore
      }
    }
  };
}


// --------------------------------------------------
// STEP 6: SINGLE BOOK RECOMMENDATION
// --------------------------------------------------

async function recommendBook(body, env, origin) {
  const situation = cleanString(
    body.situation,
    MAX_SITUATION_LENGTH
  );

  const desiredOutcome = cleanString(
    body.desiredOutcome,
    200
  ) || "surprise me";

  const format = cleanString(body.format, 20).toLowerCase();
  const language = cleanString(body.language || "any", 12).toLowerCase();
  const country = cleanString(body.country || "", 60);

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return jsonResponse({ success: false, error: "Please choose a supported language or Any language." }, 400, origin);
  }
  if (country && !SUPPORTED_COUNTRIES.has(country.toUpperCase())) {
    return jsonResponse({ success: false, error: "Please choose a supported country or Anywhere." }, 400, origin);
  }

  if (!situation || situation.length < 10) {
    return jsonResponse({
      success: false,
      error: "Please describe your situation in at least 10 characters."
    }, 400, origin);
  }

  if (format !== "books") {
    return jsonResponse({
      success: false,
      error: "This endpoint accepts books only. Choose books or movies."
    }, 400, origin);
  }


  // Step 1: Understand the situation.
  const analysis = await analyseSituation(
    situation,
    desiredOutcome,
    env,
    language,
    country
  );

  const queries = Array.isArray(analysis.search_queries)
    ? analysis.search_queries
        .map(query => cleanString(`${query} ${country ? COUNTRY_LABELS[country.toUpperCase()] || "" : ""}`, 120))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  if (!queries.length) {
    return jsonResponse({
      success: true,
      analysis,
      recommendation: null,
      message: "We couldn't identify suitable book searches for this situation."
    }, 200, origin);
  }

  // Step 2: Search the catalogue.
  const searchResult = await collectCandidates(queries, env, language);

  const candidates = searchResult.candidates;

  if (!candidates.length) {
    // Open Library is used only to discover whether records exist.
    // It is NOT used as verified recommendation evidence.
    let fallbackRecordsFound = 0;

    for (const query of queries.slice(0, 2)) {
      try {
        const records = await searchOpenLibrary(query);
        fallbackRecordsFound += records.length;
      } catch (error) {
        console.error(
          "Open Library discovery error:",
          errorMessage(error)
        );
      }
    }

    const allSearchesFailed =
      searchResult.searchErrors.length === queries.length;

    return jsonResponse({
      success: true,
      analysis,
      recommendation: null,
      catalogue: allSearchesFailed
        ? "Google Books unavailable"
        : "No usable descriptions found",
      fallbackRecordsFound,
      message: allSearchesFailed
        ? "The book catalogue is temporarily unavailable. Please try again later."
        : "We found no sufficiently detailed book descriptions to make a reliable recommendation."
   }, allSearchesFailed ? 503 : 200, origin);
  }

  // Step 3: Ask AI to evaluate actual descriptions.
  const selection = await evaluateCandidates(
    analysis,
    desiredOutcome,
    candidates,
    env
  );
  if (
    !selection ||
    typeof selection !== "object" ||
    !Array.isArray(selection.evaluations)
  ) {
    throw new Error(
      "AI book evaluation returned an invalid response."
    );
  }
  // Step 4: Calculate objective weighted scores.
  const ranked = rankCandidates(
    selection,
    candidates
  );

  if (!ranked.length) {
    return jsonResponse({
      success: true,
      analysis,
      candidatesEvaluated: candidates.length,
      recommendation: null,
      message: "We couldn't find a sufficiently relevant book for your situation. We would rather not recommend an unrelated book."
    }, 200, origin);
  }

  // Step 5: Verify books, trying the next candidate if needed.
  const result = await findVerifiedRecommendation(
    ranked,
    env
  );

  if (!result.book) {
    // If every verification attempt failed because of API errors,
    // distinguish a temporary catalogue problem from a true no-match.
    if (
      result.verificationErrors > 0 &&
      result.verificationErrors === result.attempted
    ) {
      throw new Error(
        "Google Books verification service is temporarily unavailable."
      );
    }

    return jsonResponse({
      success: true,
      analysis,
      candidatesEvaluated: candidates.length,
      recommendation: null,
      message: "We found possible books, but none passed our catalogue verification checks. Please try again later."
    }, 200, origin);
  }

  // Step 6: Return exactly one verified book.
  return jsonResponse({
    success: true,
    analysis,
    candidatesEvaluated: candidates.length,
    recommendation: {
      id: result.book.id,
      title: result.book.title,
      authors: result.book.authors,
      description: result.book.description,
      categories: result.book.categories,
      publishedDate: result.book.publishedDate,
      publisher: result.book.publisher,
      thumbnail: result.book.thumbnail,
      infoLink: result.book.infoLink,
      previewLink: result.book.previewLink,
      isbn13: result.book.isbn13,
      isbn10: result.book.isbn10,
      source: result.book.source,
      language: result.book.language || null,
      reason: result.reason,
      relevanceScore: result.relevanceScore,
      scoreBreakdown: result.scoreBreakdown
    }
  }, 200, origin);
}

// --------------------------------------------------
// CLOUDFLARE WORKER
// --------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // CORS validation.
    if (
      origin &&
      !ALLOWED_ORIGINS.includes(origin)
    ) {
      return jsonResponse(
        { error: "Origin not allowed." },
        403,
        ""
      );
    }

    // Browser preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin"
        }
      });
    }

    // Health check.
    if (
      url.pathname === "/" &&
      request.method === "GET"
    ) {
      return jsonResponse({
        status: "online",
        service: "Between the Pages API",
        version: "4.1",
supabaseConfigured: supabaseConfigured(env),
movieProviderConfigured: Boolean(env.TMDB_API_KEY),
embeddingsConfigured: Boolean(env.GEMINI_API_KEY),
semanticMovieSearchConfigured: Boolean(
  env.GEMINI_API_KEY &&
  env.SUPABASE_URL &&
  env.SUPABASE_SECRET_KEY
)
      }, 200, origin);
    }

    // Protected movie catalogue sync endpoint.
    if (
      url.pathname === "/api/admin/sync-movies" &&
      request.method === "POST"
    ) {
      try {
        const adminKey = request.headers.get("x-admin-key");

        if (
          !env.ADMIN_SYNC_KEY ||
          !adminKey ||
          adminKey !== env.ADMIN_SYNC_KEY
        ) {
          return jsonResponse(
            { success: false, error: "Unauthorized." },
            401,
            origin
          );
        }

        const body = await request.json();

        if (!isObjectRecord(body)) {
          return jsonResponse({ success: false, error: "Request body must be a JSON object." }, 400, origin);
        }

        const result = await syncMovieCataloguePage(body, env);

        return jsonResponse(result, 200, origin);

      } catch (error) {
        if (error?.name === "SyntaxError") {
          return jsonResponse({ success: false, error: "Invalid request format. Please send valid JSON." }, 400, origin);
        }
        console.error(
          "Movie catalogue sync error:",
          errorMessage(error)
        );

        return jsonResponse(
          {
            success: false,
            error: errorMessage(error)
          },
          502,
          origin
        );
      }
    }

    // Open Library discovery endpoint.
    if (
      url.pathname === "/api/books" &&
      request.method === "GET"
    ) {
      const query = cleanString(
        url.searchParams.get("q"),
        200
      );

      if (!query) {
        return jsonResponse({
          error: "Please provide a search query."
        }, 400, origin);
      }

      try {
        const books = await searchOpenLibrary(query);

        return jsonResponse({
          success: true,
          returned: books.length,
          books
        }, 200, origin);

      } catch (error) {
        console.error(
          "Book search error:",
          errorMessage(error)
        );

        return jsonResponse({
          error: "Unable to search the book catalogue."
        }, 502, origin);
      }
    }

    // Situation analysis endpoint.
    if (
      url.pathname === "/api/analyze" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        if (!isObjectRecord(body)) {
          return jsonResponse({ success: false, error: "Request body must be a JSON object." }, 400, origin);
        }

        const situation = cleanString(
          body.situation,
          MAX_SITUATION_LENGTH
        );

        const desiredOutcome = cleanString(
          body.desiredOutcome,
          200
        ) || "surprise me";

        if (!situation || situation.length < 10) {
          return jsonResponse({
            error: "Please enter a situation of at least 10 characters."
          }, 400, origin);
        }

        const analysis = await analyseSituation(
          situation,
          desiredOutcome,
          env
        );

        return jsonResponse({
          success: true,
          analysis
        }, 200, origin);

      } catch (error) {
        if (error?.name === "SyntaxError") {
          return jsonResponse({ success: false, error: "Invalid request format. Please send valid JSON." }, 400, origin);
        }
        console.error(
          "Analyze error:",
          errorMessage(error)
        );

        return jsonResponse({
          error: "The AI service could not process your request. Please try again."
        }, 502, origin);
      }
    }

    // Main recommendation endpoint.
    if (
      url.pathname === "/api/recommend" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        if (!isObjectRecord(body)) {
          return jsonResponse({ success: false, error: "Request body must be a JSON object." }, 400, origin);
        }

        const format = cleanString(body.format, 20).toLowerCase();
        if (format !== "books" && format !== "movies") {
          return jsonResponse({
            success: false,
            error: "Please choose exactly one format: books or movies."
          }, 400, origin);
        }
        const requestLanguage = cleanString(body.language || "any", 12).toLowerCase();
        const requestCountry = cleanString(body.country || "", 10).toUpperCase();
        if (!SUPPORTED_LANGUAGES.has(requestLanguage)) {
          return jsonResponse({ success: false, error: "Please choose a supported language or Any language." }, 400, origin);
        }
        if (requestCountry && !SUPPORTED_COUNTRIES.has(requestCountry)) {
          return jsonResponse({ success: false, error: "Please choose a supported country or Anywhere." }, 400, origin);
        }
        if (typeof body.situation !== "string" || body.situation.trim().length < 10 || body.situation.length > MAX_SITUATION_LENGTH) {
          return jsonResponse({ success: false, error: "Please provide a description between 10 and 5,000 characters." }, 400, origin);
        }
        if (format === "movies") {
          const movieResult = await recommendMovies(body, env);
          return jsonResponse(movieResult, 200, origin);
        }
        return await recommendBook(body, env, origin);

      
} catch (error) {
  const message = errorMessage(error);
  if (error?.name === "SyntaxError") {
  return jsonResponse({
    success: false,
    error: "Invalid request format. Please try again."
  }, 400, origin);
}

  console.error("Recommendation error:", message);

  let status = 502;
  let userMessage =
    "We couldn't complete your recommendation. Please try again.";

  if (/rate limit|quota|access limit/i.test(message)) {
    status = 429;
    userMessage =
      "Our AI or book catalogue service is temporarily busy. Please try again shortly.";
  } else if (/authentication failed/i.test(message)) {
    status = 401;
    userMessage =
      "Service authentication failed. Please check the API configuration.";
  } else if (/access denied|not configured/i.test(message)) {
    status = 403;
    userMessage =
      "The AI or book catalogue service is not authorised. Please check its configuration.";
  } else if (/timed out/i.test(message)) {
    status = 504;
    userMessage =
      "The recommendation service took too long to respond. Please try again.";
  } else if (/temporarily unavailable/i.test(message)) {
    status = 503;
    userMessage =
      "The book catalogue is temporarily unavailable. Please try again.";
  } else if (/network error/i.test(message)) {
    status = 502;
    userMessage =
      "We couldn't connect to the recommendation service. Please try again.";
  }

  return jsonResponse({
    success: false,
    error: userMessage
  }, status, origin);
}

    }

    return jsonResponse({
      error: "Endpoint not found."
    }, 404, origin);
  }
};
