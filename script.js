
// ================================================
// BETWEEN THE PAGES — FRONTEND
// Situation-based AI Book Recommender
// ================================================

const API_URL = "https://between-pages-api.kiran-kalyan-sai.workers.dev";

const button = document.getElementById("recommendBtn");
const situationInput = document.getElementById("situation");
const result = document.getElementById("result");
const charCount = document.getElementById("charCount");
const micBtn = document.getElementById("micBtn");
const micIcon = document.getElementById("micIcon");
const micStatus = document.getElementById("micStatus");

// ================================================
// 1. SECURITY AND TEXT HELPERS
// ================================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[ch]);
}

// Convert Google Books HTML descriptions into readable text.
function cleanBookDescription(html) {
  const doc = new DOMParser().parseFromString(
    String(html ?? ""),
    "text/html"
  );

  doc.querySelectorAll("br").forEach(element => {
    element.replaceWith("\n");
  });

  doc.querySelectorAll("li").forEach(element => {
    element.insertBefore(
      doc.createTextNode("• "),
      element.firstChild
    );
    element.append("\n");
  });

  doc.querySelectorAll("p, div").forEach(element => {
    element.append("\n");
  });

  return (doc.body.textContent || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Allow only HTTPS links.
// Upgrade trusted Google Books HTTP links to HTTPS.
function safeHttpsURL(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const url = new URL(value.trim());

    const googleBooksHosts = [
      "books.google.com",
      "books.google.co.in",
      "play.google.com"
    ];

    if (
      url.protocol === "http:" &&
      googleBooksHosts.includes(url.hostname.toLowerCase())
    ) {
      url.protocol = "https:";
    }

    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

// ================================================
// 2. INPUT AND NOTICE HELPERS
// ================================================

function updateCharacterCount() {
  if (charCount && situationInput) {
    charCount.textContent =
      `${situationInput.value.length} / 5000`;
  }
}

function showNotice(title, message) {
  result.innerHTML = `
    <div class="notice-card" role="status">
      <strong>${escapeHTML(title)}</strong>
      ${escapeHTML(message)}
    </div>`;
}

// ================================================
// 3. DISPLAY BOOK RECOMMENDATION
// ================================================

function displayRecommendation(data) {
  if (!data?.success || !data.recommendation) {
    showNotice(
      "No clear match this time.",
      data?.message ||
      "We couldn't find a sufficiently relevant and verifiable book. Try adding a little more context about what you need."
    );
    return;
  }

  const book = data.recommendation;

  const title = escapeHTML(
    book.title || "Untitled book"
  );

  const authors = escapeHTML(
    Array.isArray(book.authors) && book.authors.length
      ? book.authors.join(", ")
      : "Author information unavailable"
  );

  // Clean the description before escaping it.
  const descriptionText = cleanBookDescription(
    book.description ||
    "A detailed description is not available."
  );

  // Show approximately 500 characters initially.
  const descriptionPreview = escapeHTML(
    descriptionText.length > 500
      ? `${descriptionText.slice(0, 500).trim()}…`
      : descriptionText
  );

  const description = escapeHTML(descriptionText);

  const reason = escapeHTML(
    book.reason ||
    "This book was selected based on the situation you described."
  );

  // Validate image and book URLs.
  const coverURL = safeHttpsURL(book.thumbnail);
  const infoURL = safeHttpsURL(book.infoLink);
  const previewURL = safeHttpsURL(book.previewLink);

  // Book cover.
  const cover = coverURL
    ? `<img
        class="book-cover"
        src="${escapeHTML(coverURL)}"
        alt="Cover of ${title}"
        loading="lazy"
        referrerpolicy="no-referrer"
      >`
    : `<div
        class="cover-placeholder"
        role="img"
        aria-label="Book cover unavailable"
      >${title}</div>`;

  // Book links.
  const actions = [
    infoURL
      ? `<a
          class="book-link"
          href="${escapeHTML(infoURL)}"
          target="_blank"
          rel="noopener noreferrer"
        >Book details ↗</a>`
      : "",

    previewURL
      ? `<a
          class="book-link"
          href="${escapeHTML(previewURL)}"
          target="_blank"
          rel="noopener noreferrer"
        >Preview this book ↗</a>`
      : ""
  ].filter(Boolean).join("");

  // Book metadata.
  const meta = [
    book.publisher
      ? `Publisher: ${escapeHTML(book.publisher)}`
      : "",

    book.publishedDate
      ? `Published: ${escapeHTML(book.publishedDate)}`
      : "",

    book.isbn13
      ? `ISBN-13: ${escapeHTML(book.isbn13)}`
      : "",

    book.isbn10
      ? `ISBN-10: ${escapeHTML(book.isbn10)}`
      : ""
  ].filter(Boolean).join(" · ");

  // Render recommendation card.
  result.innerHTML = `
    <article
      class="result-card"
      aria-labelledby="recommended-book-title"
    >

      <div class="book-visual">
        ${cover}
      </div>

      <div class="book-details">

        <div class="result-label">
          YOUR BOOK FOR THIS MOMENT
        </div>

        <h2
          class="book-title"
          id="recommended-book-title"
        >${title}</h2>

        <p class="book-author">
          By ${authors}
        </p>

        <h3 class="result-subhead">
          Why this book?
        </h3>

        <p>${reason}</p>

        <h3 class="result-subhead">
          What it covers
        </h3>

        <div class="book-description">

          <p>${descriptionPreview}</p>

          ${
            descriptionText.length > 500
              ? `
                <details class="description-expand">

                  <summary>
                    Read full description
                  </summary>

                  <p>${description}</p>

                </details>
              `
              : ""
          }

        </div>

        ${meta
          ? `<div class="book-meta">${meta}</div>`
          : ""
        }

        ${actions
          ? `<div class="book-actions">${actions}</div>`
          : ""
        }

        <div class="book-meta">
          Book record supplied by
          ${escapeHTML(book.source || "the book catalogue")}.
          Availability may vary by location and edition.
        </div>

      </div>

    </article>`;

  const descriptionDetails = result.querySelector(
    ".description-expand"
  );

  if (descriptionDetails) {
    const summary = descriptionDetails.querySelector("summary");

    descriptionDetails.addEventListener("toggle", () => {
      summary.textContent = descriptionDetails.open
        ? "Read less"
        : "Read full description";
    });
  }
}
// ================================================
// 4. GET BOOK RECOMMENDATION
// ================================================

async function getRecommendation() {
  const situation = situationInput.value.trim();

  if (situation.length < 10) {
    showNotice(
      "Tell us a little more.",
      "A few sentences about what's happening will help us find a more meaningful match."
    );

    situationInput.focus();
    return;
  }

  if (situation.length > 5000) {
    showNotice(
      "That's a little too long.",
      "Please keep your description within 5,000 characters."
    );
    return;
  }

  button.disabled = true;

  button.innerHTML = `
    <span>Finding your one book…</span>
    <span class="button-arrow" aria-hidden="true">✦</span>`;

  result.innerHTML = `
    <div
      class="loading-card"
      role="status"
      aria-live="polite"
    >
      <span class="loader" aria-hidden="true"></span>

      <span>
        Understanding your situation and looking for a thoughtful match…
      </span>
    </div>`;

  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    90000
  );

  try {
    const response = await fetch(
      `${API_URL}/api/recommend`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          situation,
          desiredOutcome: "surprise me",
          format: "books"
        }),

        signal: controller.signal
      }
    );

    const data = await response.json().catch(() => ({}));

    // Handle HTTP errors.
    if (!response.ok) {
      throw new Error(
        data.error ||
        `The recommendation service returned an error (${response.status}).`
      );
    }

    // Handle successful requests with no suitable book.
    if (data.success && !data.recommendation) {
      showNotice(
        "We couldn't find your one book just yet.",
        data.message ||
        "We couldn't find a sufficiently relevant book for your situation. Try describing your situation differently."
      );

      return;
    }

    // Handle unsuccessful API responses.
    if (!data.success) {
      throw new Error(
        data.error ||
        "The recommendation service couldn't complete your request."
      );
    }

    // Display the selected book.
    displayRecommendation(data);

  } catch (error) {
    const message = error.name === "AbortError"
      ? "The search is taking longer than expected. Please try again in a moment."
      : (
          error.message ||
          "We couldn't reach the recommendation service. Please try again."
        );

    showNotice(
      "We couldn't complete your recommendation.",
      message
    );

    console.error(
      "Between the Pages request failed:",
      error
    );

  } finally {
    clearTimeout(timeoutId);

    button.disabled = false;

    button.innerHTML = `
      <span>Find my one book</span>
      <span class="button-arrow" aria-hidden="true">↗</span>`;

    result.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }
}

// ================================================
// 5. BUTTON AND KEYBOARD EVENTS
// ================================================

button.addEventListener(
  "click",
  getRecommendation
);

situationInput.addEventListener(
  "input",
  updateCharacterCount
);

situationInput.addEventListener(
  "keydown",
  event => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter"
    ) {
      getRecommendation();
    }
  }
);

// ================================================
// 6. SPEECH RECOGNITION
// ================================================

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

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

    micStatus.textContent =
      "Listening… speak naturally.";
  };

  recognition.onresult = event => {
    let transcript = "";

    for (
      let i = 0;
      i < event.results.length;
      i++
    ) {
      transcript +=
        event.results[i][0].transcript;
    }

    situationInput.value =
      transcript.slice(0, 5000);

    updateCharacterCount();
  };

  recognition.onerror = event => {

    micStatus.textContent =
      event.error === "not-allowed"
        ? "Microphone permission was denied. You can still type your situation."

        : event.error === "no-speech"
          ? "No speech detected. Please try again."

          : "Voice input isn't available right now. You can type instead.";
  };

  recognition.onend = () => {

    isRecording = false;

    micBtn.classList.remove("recording");

    micIcon.textContent = "🎙";

    if (situationInput.value.trim()) {
      micStatus.textContent =
        "Your words are here. Feel free to edit them.";
    }
  };

  micBtn.addEventListener("click", () => {

    if (isRecording) {
      recognition.stop();

    } else {

      try {
        recognition.start();

      } catch {
        micStatus.textContent =
          "Please try again in a moment.";
      }
    }
  });

} else if (micBtn) {

  micBtn.addEventListener("click", () => {

    micStatus.textContent =
      "Voice input isn't supported in this browser. You can type your situation instead.";
  });
}

// ================================================
// 7. INITIALIZE FRONTEND
// ================================================

updateCharacterCount();

console.log(
  "Between the Pages frontend loaded."
);
