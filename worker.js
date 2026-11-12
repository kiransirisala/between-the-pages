
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://localhost:5500"
  // Add your deployed website origin here before public launch.
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

    console.error(
      "Groq API error:",
      response.status,
      detail.slice(0, 1000)
    );

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
    console.error(
      "Groq returned invalid JSON:",
      content.slice(0, 1000)
    );

    throw new Error(
      "AI service returned an invalid response."
    );
  }
}


// --------------------------------------------------
// GOOGLE BOOKS SEARCH
// --------------------------------------------------

async function searchGoogleBooks(query, env) {
  if (!env.GOOGLE_BOOKS_API_KEY) {
    throw new Error("Google Books authentication failed: API key is not configured.");
  }

  const url = new URL(
    "https://www.googleapis.com/books/v1/volumes"
  );

  url.searchParams.set("q", query);
  url.searchParams.set("langRestrict", "en");
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

    console.error(
      "Google Books search error:",
      response.status,
      detail.slice(0, 500)
    );

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

if (!isbn13 && !isbn10) {
  failedChecks.push("Missing ISBN");
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

async function analyseSituation(situation, desiredOutcome, env) {
  const analysis = await callGroq(env, [
    {
      role: "system",
      content: `You are the situation-understanding engine for Between the Pages.

Understand the user's actual circumstances, profession, interests, challenge, underlying need and desired outcome.

Do not rely on simple keyword matching.

Generate three distinct, concise English book-catalogue search queries.

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
      content: JSON.stringify({
        situation,
        desired_outcome: desiredOutcome
      })
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

async function collectCandidates(queries, env) {
  const uniqueBooks = new Map();
  const searchErrors = [];

  for (const rawQuery of queries.slice(0, 3)) {
    const query = cleanString(rawQuery, 120);
    if (!query) continue;

    try {
      const books = await searchGoogleBooks(query, env);

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
      const verified = await verifyGoogleBook(
        candidate.book,
        env
      );

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

  const format = cleanString(
    body.format,
    20
  ).toLowerCase() || "books";

  if (!situation || situation.length < 10) {
    return jsonResponse({
      success: false,
      error: "Please describe your situation in at least 10 characters."
    }, 400, origin);
  }

  if (!["books", "movies", "both"].includes(format)) {
    return jsonResponse({
      success: false,
      error: "Format must be books, movies or both."
    }, 400, origin);
  }

  if (format !== "books") {
    return jsonResponse({
      success: false,
      code: "MOVIE_SOURCE_NOT_CONFIGURED",
      recommendation: null,
      message: "Book recommendations are available. Movie recommendations are coming soon."
    }, 501, origin);
  }

  // Step 1: Understand the situation.
  const analysis = await analyseSituation(
    situation,
    desiredOutcome,
    env
  );

  const queries = Array.isArray(analysis.search_queries)
    ? analysis.search_queries
        .map(query => cleanString(query, 120))
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
  const searchResult = await collectCandidates(
    queries,
    env
  );

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
        version: "0.3"
      }, 200, origin);
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

        return await recommendBook(
          body,
          env,
          origin
        );

      
} catch (error) {
  const message = errorMessage(error);
  if (error instanceof SyntaxError) {
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
