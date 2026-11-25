// BETWEEN THE PAGES — frontend
// Choose one: Books OR Movies.

const API_URL = "https://between-pages-api.kiran-kalyan-sai.workers.dev";

const button = document.getElementById("recommendBtn");
const situationInput = document.getElementById("situation");
const result = document.getElementById("result");
const charCount = document.getElementById("charCount");
const micBtn = document.getElementById("micBtn");
const micIcon = document.getElementById("micIcon");
const micStatus = document.getElementById("micStatus");
const formatSelect = document.getElementById("formatSelect");
const languageSelect = document.getElementById("languageSelect");
const countrySelect = document.getElementById("countrySelect");

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[ch]);
}

function safeHttpsURL(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function updateCharacterCount() {
  charCount.textContent = `${situationInput.value.length} / 5000`;
}

function showNotice(title, message) {
  result.innerHTML = `
    <div class="notice-card">
      <strong>${escapeHTML(title)}</strong>
      ${escapeHTML(message)}
    </div>`;
}

function renderContentCard(item, kind) {
  if (!item) return `<div class="notice-card"><strong>No ${kind} match found.</strong> Try changing your preferences or describing your situation differently.</div>`;
  const isMovie = kind === "movie";
  const title = escapeHTML(item.title || "Untitled");
  const description = escapeHTML(isMovie ? item.overview : item.description);
  const reason = escapeHTML(item.reason || "Selected for the situation you described.");
  const image = safeHttpsURL(isMovie ? item.poster_path : item.thumbnail);
  const imageMarkup = image
    ? `<img class="book-cover" src="${escapeHTML(image)}" alt="${isMovie ? "Poster" : "Cover"} of ${title}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="cover-placeholder">${title}</div>`;
  const byline = isMovie
    ? [item.release_date, item.original_language ? `Original language: ${item.original_language.toUpperCase()}` : ""].filter(Boolean).map(escapeHTML).join(" · ")
    : `By ${escapeHTML(Array.isArray(item.authors) ? item.authors.join(", ") : "Author information unavailable")}`;
  const link = safeHttpsURL(isMovie ? item.tmdb_url : item.infoLink);
  const meta = isMovie
    ? (Array.isArray(item.genres) ? item.genres.map(escapeHTML).join(" · ") : "")
    : [item.publisher, item.publishedDate, item.isbn13 ? `ISBN-13: ${item.isbn13}` : ""].filter(Boolean).map(escapeHTML).join(" · ");
  return `<article class="result-card">
    <div class="book-visual">${imageMarkup}</div>
    <div class="book-details">
      <div class="result-label">YOUR ${isMovie ? "MOVIE" : "BOOK"} FOR THIS MOMENT</div>
      <h2 class="book-title">${title}</h2>
      <p class="book-author">${byline}</p>
      <h3 class="result-subhead">Why this ${kind}?</h3><p>${reason}</p>
      <h3 class="result-subhead">${isMovie ? "Story" : "What it covers"}</h3><p>${description || "A detailed description is not available."}</p>
      ${meta ? `<div class="book-meta">${meta}</div>` : ""}
      ${link ? `<div class="book-actions"><a class="book-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${isMovie ? "View on TMDB" : "Book details"} ↗</a></div>` : ""}
      <div class="book-meta">Catalogue information supplied by ${isMovie ? "TMDB" : escapeHTML(item.source || "Google Books")}.</div>
    </div></article>`;
}

function displayRecommendation(data, format) {
  const item = data?.recommendation;
  if (!data?.success || !item) {
    showNotice("No clear match this time.", data?.message || "We couldn't find a sufficiently relevant match. Try adding a little more context.");
    return;
  }
  result.innerHTML = renderContentCard(item, format === "movies" ? "movie" : "book");
}

async function getRecommendation() {
  const situation = situationInput.value.trim();

  if (situation.length < 10) {
    showNotice("Tell us a little more.", "A few sentences about what's happening will help us find a more meaningful match.");
    situationInput.focus();
    return;
  }

  if (situation.length > 5000) {
    showNotice("That's a little too long.", "Please keep your description within 5,000 characters.");
    return;
  }

  button.disabled = true;
  button.innerHTML = `<span>Finding your recommendation…</span><span class="button-arrow">✦</span>`;
  result.innerHTML = `<div class="loading-card"><span class="loader" aria-hidden="true"></span><span>Understanding your situation and looking for a thoughtful match…</span></div>`;

  try {
    const format = formatSelect.value;
    if (format !== "books" && format !== "movies") {
      throw new Error("Please choose either Books or Movies.");
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    let response;
    try {
      response = await fetch(`${API_URL}/api/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          situation,
          desiredOutcome: "surprise me",
          format,
          language: languageSelect.value,
          country: countrySelect.value
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `The recommendation service returned an error (${response.status}).`);
    }

    displayRecommendation(data, format);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "The search is taking longer than expected. Please try again in a moment."
      : (error.message || "We couldn't reach the recommendation service. Please try again.");
    showNotice("We couldn't complete your recommendation.", message);
    console.error("Between the Pages request failed:", error);
  } finally {
    button.disabled = false;
    button.innerHTML = `<span>Find my recommendation</span><span class="button-arrow" aria-hidden="true">↗</span>`;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

button.addEventListener("click", getRecommendation);
situationInput.addEventListener("input", updateCharacterCount);
situationInput.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") getRecommendation();
});

// Browser speech recognition is optional and browser-dependent.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

if (SpeechRecognition && micBtn) {
  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micIcon.textContent = "■";
    micStatus.textContent = "Listening… speak naturally.";
  };

  recognition.onresult = event => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    situationInput.value = transcript.slice(0, 5000);
    updateCharacterCount();
  };

  recognition.onerror = event => {
    micStatus.textContent = event.error === "not-allowed"
      ? "Microphone permission was denied. You can still type your situation."
      : event.error === "no-speech"
        ? "No speech detected. Please try again."
        : "Voice input isn't available right now. You can type instead.";
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
    micIcon.textContent = "🎙";
    if (situationInput.value.trim()) micStatus.textContent = "Your words are here. Feel free to edit them.";
  };

  micBtn.addEventListener("click", () => {
    if (isRecording) recognition.stop();
    else {
      try { recognition.start(); }
      catch { micStatus.textContent = "Please try again in a moment."; }
    }
  });
} else if (micBtn) {
  micBtn.addEventListener("click", () => {
    micStatus.textContent = "Voice input isn't supported in this browser. You can type your situation instead.";
  });
}

updateCharacterCount();
console.log("Between the Pages frontend refresh loaded.");
