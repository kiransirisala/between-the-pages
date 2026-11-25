import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const workerPath = new URL("../worker.js", import.meta.url);
const source = await readFile(workerPath, "utf8");
const moduleDir = await mkdtemp(join(tmpdir(), "between-pages-test-"));
const modulePath = join(moduleDir, "worker.mjs");
await writeFile(modulePath, source, "utf8");
const workerModule = await import(pathToFileURL(modulePath).href);
const worker = workerModule.default;
const nativeLog = console.log;
const nativeError = console.error;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function completion(name, body) {
  const user = JSON.parse(body.messages.at(-1).content);
  let content;
  if (name === "movie_analysis") {
    content = JSON.stringify(globalThis.mockMovieAnalysis || {
      intent: "recommend", situation_summary: "A story about hope",
      user_context: "", main_challenge: "", underlying_need: "hope",
      desired_outcome: "encouragement", plot_clues: [],
      search_queries: ["hope after hardship"]
    });
  } else if (name === "movie_evaluation") {
    const id = user.candidates[0]?.id;
    content = JSON.stringify({ evaluations: id ? [{
      id, situationScore: 5, practicalScore: 4, contextScore: 5,
      evidenceScore: 5, categoryScore: 4,
      reason: "The synopsis supports the distinctive story clues."
    }] : [] });
  } else if (name === "situation_analysis") {
    content = JSON.stringify({ situation_summary: "Learning request", user_context: "",
      main_challenge: "", underlying_need: "learn", desired_outcome: "understanding",
      search_queries: ["learning practical skills"] });
  } else {
    const id = user.candidates[0]?.id;
    content = JSON.stringify({ evaluations: id ? [{
      id, situationScore: 5, practicalScore: 4, contextScore: 4,
      evidenceScore: 5, categoryScore: 4,
      reason: "The description directly covers the requested learning goal."
    }] : [] });
  }
  return json({ choices: [{ message: { content } }] });
}

function movieDetails(id, title = "Test Movie", overrides = {}) {
  return {
    id: Number(id), title, original_title: title,
    overview: overrides.overview || "A detailed synopsis long enough for verification. " +
      "The characters face a series of events that resolve the story.",
    release_date: "2000-01-01", original_language: overrides.original_language || "en",
    spoken_languages: (overrides.spoken_languages || ["en"]).map(code => ({ iso_639_1: code })),
    production_countries: (overrides.production_countries || ["US"]).map(code => ({ iso_3166_1: code })),
    genres: [{ name: "Drama" }], poster_path: null
  };
}

async function post(body, env = {}) {
  return worker.fetch(new Request("https://test.example/api/recommend", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://between-the-pages.pages.dev" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }), env);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("rejects invalid formats and non-object JSON before provider calls", async () => {
  const calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); return json({}); };
  let response = await post({ format: "both", situation: "long enough to pass validation" }, {});
  assert.equal(response.status, 400);
  response = await post("null", {});
  assert.equal(response.status, 400);
  response = await post("{", {});
  assert.equal(response.status, 400);
  response = await post({ format: "movies", situation: "long enough to pass validation", language: "xx" }, {});
  assert.equal(response.status, 400);
  response = await post({ format: "books", situation: "long enough to pass validation", country: "ZZ" }, {});
  assert.equal(response.status, 400);
  response = await post({ format: "books", situation: "x".repeat(5001) }, {});
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("identifies Cast Away from plot clues, honors spoken-language and country filters, and tolerates cache write failure", async () => {
  const urls = [];
  globalThis.mockMovieAnalysis = {
    intent: "identify", situation_summary: "A survivor befriends a volleyball",
    user_context: "", main_challenge: "Survive after a crash", underlying_need: "identify a movie",
    desired_outcome: "remember the title",
    plot_clues: ["plane crash", "isolated island", "survives alone", "volleyball companion"],
    search_queries: ["plane crash island volleyball", "isolated island survival volleyball"]
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === "api.groq.com") return completion(JSON.parse(init.body).response_format.json_schema.name, JSON.parse(init.body));
    if (url.hostname === "example.supabase.co") {
      if (init.method === "POST") return json({ message: "mock cache unavailable" }, 503);
      return json([]);
    }
    if (url.pathname === "/3/search/keyword") return json({ results: [{ id: 777, name: "volleyball" }] });
    if (url.pathname === "/3/discover/movie") return json({ results: [{ id: 13, title: "Cast Away", original_title: "Cast Away", overview: "A man survives alone on a remote island after a plane crash." }] });
    if (url.pathname === "/3/search/movie") return json({ results: [] });
    if (url.pathname === "/3/movie/13") return json(movieDetails(13, "Cast Away", {
      overview: "After a plane crash leaves him stranded on a remote island, a man struggles to survive alone and forms an unusual bond with a volleyball.",
      original_language: "en", spoken_languages: ["en", "hi"], production_countries: ["US"]
    }));
    throw new Error(`Unexpected URL ${url}`);
  };
  const response = await post({ format: "movies", situation: "A man is stranded after a plane crash on an isolated island, survives alone and befriends a volleyball.", language: "hi", country: "US" }, {
    GROQ_API_KEY: "mock", TMDB_API_KEY: "mock", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "mock"
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.recommendation?.title, "Cast Away", JSON.stringify(data));
  assert.equal(urls.some(url => url.searchParams.get("with_genres") === "18"), false, "identification must not invoke drama fallback");
  assert.ok(urls.some(url => url.pathname === "/3/movie/13"));
});

test("retains the mood recommendation drama fallback", async () => {
  const urls = [];
  globalThis.mockMovieAnalysis = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === "api.groq.com") return completion(JSON.parse(init.body).response_format.json_schema.name, JSON.parse(init.body));
    if (url.pathname === "/3/search/keyword") return json({ results: [] });
    if (url.pathname === "/3/discover/movie") {
      if (url.searchParams.get("with_genres") === "18") {
        return json({ results: Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, title: `Drama ${i}`, overview: "An overview long enough to be considered for detailed verification." })) });
      }
      return json({ results: [] });
    }
    if (url.pathname.startsWith("/3/movie/")) return json(movieDetails(url.pathname.split("/").at(-1), `Drama ${url.pathname.split("/").at(-1)}`));
    throw new Error(`Unexpected URL ${url}`);
  };
  const response = await post({ format: "movies", situation: "I feel stuck in my career and need a story that helps me keep hope." }, { GROQ_API_KEY: "mock", TMDB_API_KEY: "mock" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.recommendation, JSON.stringify(data));
  assert.ok(urls.some(url => url.searchParams.get("with_genres") === "18"));
});

test("identifies a second remembered plot from character and story clues", async () => {
  globalThis.mockMovieAnalysis = {
    intent: "identify", situation_summary: "A child helps an alien return home", user_context: "",
    main_challenge: "An alien is stranded", underlying_need: "identify the movie", desired_outcome: "remember",
    plot_clues: ["boy befriends alien", "alien stranded on Earth", "helps alien return home"],
    search_queries: ["boy befriends stranded extraterrestrial", "child helps alien return home"]
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "api.groq.com") return completion(JSON.parse(init.body).response_format.json_schema.name, JSON.parse(init.body));
    if (url.pathname === "/3/search/keyword") return json({ results: [{ id: 991, name: "extraterrestrial" }] });
    if (url.pathname === "/3/discover/movie") return json({ results: [{ id: 601, title: "E.T. the Extra-Terrestrial", overview: "A boy befriends an alien stranded on Earth and helps him return home." }] });
    if (url.pathname === "/3/search/movie") return json({ results: [] });
    if (url.pathname === "/3/movie/601") return json(movieDetails(601, "E.T. the Extra-Terrestrial", {
      overview: "A lonely boy discovers and befriends an extraterrestrial stranded on Earth, then helps the alien return home while evading authorities."
    }));
    throw new Error(`Unexpected URL ${url}`);
  };
  const response = await post({ format: "movies", situation: "What movie had a boy who befriends a stranded alien and helps it get back home?" }, { GROQ_API_KEY: "mock", TMDB_API_KEY: "mock" });
  const data = await response.json();
  assert.equal(data.recommendation?.title, "E.T. the Extra-Terrestrial", JSON.stringify(data));
});

test("returns no match without filling an identification request with generic movies", async () => {
  const urls = [];
  globalThis.mockMovieAnalysis = {
    intent: "identify", situation_summary: "A vague remembered scene", user_context: "",
    main_challenge: "", underlying_need: "identify a title", desired_outcome: "remember",
    plot_clues: ["unusual machine in a desert"], search_queries: ["unusual machine desert movie"]
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === "api.groq.com") return completion(JSON.parse(init.body).response_format.json_schema.name, JSON.parse(init.body));
    if (url.pathname === "/3/search/keyword" || url.pathname === "/3/search/movie") return json({ results: [] });
    if (url.pathname === "/3/discover/movie") return json({ results: [] });
    throw new Error(`Unexpected URL ${url}`);
  };
  const response = await post({ format: "movies", situation: "I vaguely remember an unusual machine in a desert, but cannot recall the title." }, { GROQ_API_KEY: "mock", TMDB_API_KEY: "mock" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.recommendation, null);
  assert.ok(!urls.some(url => url.searchParams.get("with_genres") === "18"));
});

test("Google Books search continues after a Supabase cache lookup error", async () => {
  const urls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.hostname === "api.groq.com") return completion(JSON.parse(init.body).response_format.json_schema.name, JSON.parse(init.body));
    if (url.hostname === "example.supabase.co") return json({ message: "mock database outage" }, 503);
    if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/books/v1/volumes")) {
      if (url.pathname === "/books/v1/volumes" && url.searchParams.has("q")) return json({ items: [{ id: "book-1", volumeInfo: {
        title: "Learning by Doing", authors: ["A. Writer"], description: "A practical guide with enough detail to explain its methods, examples, exercises, and learning approach for the reader.", categories: ["Education"], language: "en"
      } }] });
      return json({ id: "book-1", volumeInfo: {
        title: "Learning by Doing", authors: ["A. Writer"], description: "A practical guide with enough detail to explain its methods, examples, exercises, and learning approach for the reader.", categories: ["Education"], language: "en", infoLink: "https://books.google.com/books?id=book-1"
      } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const response = await post({ format: "books", situation: "I want to learn practical skills and understand how to improve through practice." }, {
    GROQ_API_KEY: "mock", GOOGLE_BOOKS_API_KEY: "mock", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "mock"
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.recommendation?.title, "Learning by Doing", JSON.stringify(data));
  assert.ok(urls.some(url => url.hostname === "www.googleapis.com" && url.searchParams.has("q")));
  assert.ok(!urls.some(url => url.hostname.includes("tmdb")));
});

let failed = 0;
const failures = [];
console.log = () => {};
console.error = () => {};
for (const item of tests) {
  try {
    await item.fn();
    nativeLog(`PASS ${item.name}`);
  } catch (error) {
    failed++;
    failures.push(`${item.name}: ${error.stack || error}`);
    nativeError(`FAIL ${item.name}\n${error.stack || error}`);
  }
}
console.log = nativeLog;
console.error = nativeError;
await rm(moduleDir, { recursive: true, force: true });
if (failed) throw new Error(`${failed} regression test(s) failed:\n${failures.join("\n")}`);
nativeLog(`${tests.length} regression tests passed.`);
