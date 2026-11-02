/* Ghar Ka Doctor — frontend logic (vanilla JS, no build step)

   Session flow: a welcome screen asks WHICH case + WHICH language at the
   start of every session; upload is a separate card from the demo cases. */

const $ = (id) => document.getElementById(id);

const state = {
  reportId: null,
  selectedCase: "case-a", // "case-a" | "case-b" | "upload"
  presetMeta: {},         // id -> {title, description}
  sampleDoubts: [],
  translationsCache: {},  // language_code -> [translated doubts]
  storyAudio: null,
  transcript: "",
  answerText: "",
  activeLang: "hi-IN",    // concrete language used by all 🔊 buttons
  langNames: {},          // code -> "Tamil (தமிழ்)"
  recorder: null,
  chunks: [],
};

/* ---------- audio everywhere ----------
   One shared helper: every 🔊 button speaks its text via POST /api/speak,
   cached per (language, text) so nothing is asked twice. */

const audioCache = new Map();
let currentAudio = null;
let playingBtn = null;

function setPlaying(btn, on) {
  if (!btn) return;
  btn.classList.toggle("playing", on);
  btn.textContent = on ? "⏹" : "🔊";
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  setPlaying(playingBtn, false);
  playingBtn = null;
}

async function speak(text, btn) {
  const clean = (text || "").trim();
  if (!clean) return;
  if (btn && playingBtn === btn) { stopAudio(); return; } // toggle off
  stopAudio();

  const lang = state.activeLang;
  const key = `${lang}|${clean}`;
  let uri = audioCache.get(key);

  if (uri === undefined) {
    if (btn) setPlaying(btn, true); // show activity while fetching
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean.slice(0, 2000), language_code: lang }),
      });
      const data = await res.json();
      uri = data.audio_base64 ? `data:audio/mpeg;base64,${data.audio_base64}` : null;
    } catch {
      uri = null;
    }
    if (uri) audioCache.set(key, uri);
    if (btn && !uri) setPlaying(btn, false);
  }

  if (!uri) {
    flash($("doubt-status"), "Voice isn't available for this language — showing text.", true, false);
    return;
  }

  currentAudio = new Audio(uri);
  playingBtn = btn;
  setPlaying(btn, true);
  currentAudio.onended = () => stopAudio();
  currentAudio.onerror = () => stopAudio();
  currentAudio.play().catch(() => stopAudio());
}

function makeSpeakButton(text, title = "Listen to this") {
  const btn = document.createElement("button");
  btn.className = "icon-speak";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.textContent = "🔊";
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // never trigger the card the button lives in
    speak(text, btn);
  });
  return btn;
}

/* Every element with data-say gets a 🔊 button AFTER its text. */
function decorateDataSay() {
  document.querySelectorAll("[data-say]").forEach((el) => {
    if (el.querySelector(":scope > .icon-speak")) return; // idempotent
    el.appendChild(makeSpeakButton(el.dataset.say, "Listen"));
  });
}

/* ---------- init & session flow ---------- */

async function init() {
  // Wire ALL event listeners FIRST, synchronously — clicks must work even
  // if the network is down, the server is cold, or a fetch fails.
  wireWelcome();
  wireSessionControls();
  decorateDataSay();
  setBackgroundInert(true); // welcome dialog is open; page behind is inert
  window.addEventListener("error", (e) => showFatal(e.message));
  window.addEventListener("unhandledrejection", (e) => showFatal(String(e.reason)));

  await safeLoad(loadLanguages, "language list");
  await safeLoad(loadWelcomeCards, "demo cases");
}

function showFatal(msg) {
  const el = $("fatal-error");
  if (!el) return;
  el.textContent = `⚠️ ${msg}. If this keeps happening, hard-refresh (Ctrl+Shift+R).`;
  el.classList.remove("hidden");
}

async function safeLoad(fn, label) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} failed:`, err);
    showFatal(`Couldn't load the ${label}`);
  }
}

const LANG_FALLBACK = [
  ["hi-IN", "हिन्दी — Hindi"],
  ["en-IN", "English — English"],
];

async function loadLanguages() {
  try {
    const res = await fetch("/api/languages");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const sel = $("language");
    for (const [code, info] of Object.entries(data.languages)) {
      state.langNames[code] = `${info.native} — ${info.name}`;
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = info.tts
        ? `${info.native} — ${info.name}`
        : `${info.native} — ${info.name} (text only)`;
      sel.appendChild(opt);
    }
    sel.value = data.default;
  } catch (err) {
    // Offline fallback so the session can still start.
    const sel = $("language");
    if (!sel.options.length) {
      for (const [code, label] of LANG_FALLBACK) {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = label;
        sel.appendChild(opt);
      }
      sel.value = "hi-IN";
    }
    throw err; // safeLoad shows the banner
  }
  // Voice chat: let Saaras auto-detect the spoken language.
  const sel = $("language");
  if (!sel.querySelector('option[value="unknown"]')) {
    const auto = document.createElement("option");
    auto.value = "unknown";
    auto.textContent = "🌐 Auto-detect — spoken doubts in any language";
    sel.insertBefore(auto, sel.firstChild);
  }
}

async function loadWelcomeCards() {
  let presets = [];
  try {
    const res = await fetch("/api/presets");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    presets = await res.json();
  } catch (err) {
    console.error("presets fetch failed (using static titles):", err);
    return; // non-fatal: static titles/descriptions are already in the HTML
  }
  for (const p of presets) state.presetMeta[p.id] = p;
  document.querySelectorAll(".case-card[data-case]").forEach((card) => {
    const meta = state.presetMeta[card.dataset.case];
    if (!meta) return;
    card.querySelector(".case-desc").textContent = meta.description;
    // Non-readers must be able to choose: speak title + description.
    // Sibling of the card (never inside it) — nested buttons are invalid HTML.
    card.parentElement.appendChild(
      makeSpeakButton(`${meta.title}. ${meta.description}`, "Listen to this case")
    );
  });
  // Upload card: speak its purpose too
  $("upload-card").appendChild(
    makeSpeakButton(
      "Or upload a real report or prescription. Click below to choose a photo or PDF, and I will read it for you.",
      "Listen to this option"
    )
  );
}

function wireWelcome() {
  // Case cards: pick one
  document.querySelectorAll(".case-card[data-case]").forEach((card) => {
    card.addEventListener("click", () => selectCase(card.dataset.case));
  });

  // Upload is a separate card — choosing a file switches the session to it
  $("file").addEventListener("change", () => {
    const f = $("file").files[0];
    const label = $("file-name");
    label.textContent = f ? `📄 ${f.name}` : "Click to choose a photo or PDF — I'll read it with Vision OCR";
    label.parentElement.classList.toggle("has-file", !!f);
    if (f) selectCase("upload");
  });
  $("upload-card").addEventListener("click", (e) => {
    if (e.target.closest("label") || e.target.closest("input") || e.target.closest(".icon-speak")) return;
    $("file").click(); // clicking the card (not the drop zone) opens the picker
  });

  $("start").addEventListener("click", startSession);
}

function selectCase(id) {
  state.selectedCase = id;
  document.querySelectorAll(".case-card").forEach((c) => c.classList.remove("selected"));
  document.querySelectorAll(".case-card[data-case]").forEach((c) => c.setAttribute("aria-pressed", "false"));
  const el = document.querySelector(id === "upload" ? "#upload-card" : `.case-card[data-case="${id}"]`);
  if (el) el.classList.add("selected");
  if (id !== "upload") el.setAttribute("aria-pressed", "true");
}

/* While the welcome dialog is open the rest of the page is inert. */
function setBackgroundInert(on) {
  for (const el of [document.querySelector(".topbar"), document.querySelector("main"), document.querySelector("footer")]) {
    if (el) el.inert = on;
  }
}

function moveFocus(el) {
  if (el) el.focus({ preventScroll: true });
}

async function startSession() {
  const btn = $("start");
  const status = $("welcome-status");
  btn.disabled = true;
  flash(status, "Reading the report…");

  try {
    const fd = new FormData();
    const lang = $("language").value;
    // Auto-detect applies to spoken doubts; the report itself needs a real language.
    fd.append("language_code", lang === "unknown" ? "hi-IN" : lang);
    if (state.selectedCase === "upload") {
      const file = $("file").files[0];
      if (!file) { flash(status, "Choose a report photo or PDF first — or pick Case A / B.", true); return; }
      fd.append("file", file);
    } else {
      fd.append("preset_id", state.selectedCase);
    }

    const res = await fetch("/api/analyze-report", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Analysis failed");

    state.reportId = data.report_id;
    state.storyAudio = data.audio_base64;

    // Move the language select into the session bar and enter the app.
    $("session-lang-slot").appendChild($("language"));
    const caseTitle =
      state.selectedCase === "upload"
        ? "📄 Your uploaded report"
        : `📋 ${state.presetMeta[state.selectedCase]?.title || state.selectedCase}`;
    const sc = $("session-case");
    sc.textContent = caseTitle; // clears any previous 🔊
    sc.appendChild(makeSpeakButton(
      caseTitle.replace(/^📄|^📋/, "").trim(),
      "Listen to the active case"
    ));
    $("welcome").classList.add("hidden");
    setBackgroundInert(false);
    $("session-bar").classList.remove("hidden");
    $("board").classList.remove("hidden");
    $("doubt").classList.remove("hidden");

    renderBoard(data);
    loadSampleDoubts(state.selectedCase === "upload" ? null : state.selectedCase);
    moveFocus($("session-bar")); // focus leaves the closed dialog deliberately
    if (state.storyAudio) play(state.storyAudio); // audio-first session start
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  } catch (err) {
    flash(status, `⚠️ ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

function wireSessionControls() {
  $("change-case").addEventListener("click", () => {
    stopAudio();
    state.reportId = null;
    state.storyAudio = null;
    state.transcript = "";
    state.answerText = "";
    $("board").classList.add("hidden");
    $("doubt").classList.add("hidden");
    $("session-bar").classList.add("hidden");
    $("answer").classList.add("hidden");
    flash($("doubt-status"), "");
    $("welcome-status").textContent = "";
    $("welcome-lang-slot").appendChild($("language")); // move select back
    $("welcome").classList.remove("hidden");
    setBackgroundInert(true);
    moveFocus(document.querySelector(".welcome-card"));
    window.scrollTo({ top: 0 });
  });

  $("language").addEventListener("change", () => {
    stopAudio();
    if ($("language").value !== "unknown") state.activeLang = $("language").value;
    translateChips().catch(console.error);
  });

  $("ask").addEventListener("click", askTyped);
  $("question").addEventListener("keydown", (e) => { if (e.key === "Enter") askTyped(); });
  $("play-story").addEventListener("click", () => play(state.storyAudio));
  $("speak-transcript").addEventListener("click", () => speak(state.transcript, $("speak-transcript")));
  $("speak-answer").addEventListener("click", () => speak(state.answerText, $("speak-answer")));
  $("speak-safety").addEventListener("click", (e) => speak(state.safetySpeak, e.currentTarget));
  $("speak-checked").addEventListener("click", (e) => speak(state.checkedText, e.currentTarget));
  $("speak-misconception").addEventListener("click", (e) => speak(state.misconceptionText, e.currentTarget));
  setupMic();
}

/* ---------- sample doubts ---------- */

async function loadSampleDoubts(presetId) {
  if (!presetId) { state.sampleDoubts = []; renderChips([]); return; }
  const res = await fetch("/api/presets");
  const presets = await res.json();
  const preset = presets.find((p) => p.id === presetId);
  state.sampleDoubts = preset ? preset.sample_doubts : [];
  state.translationsCache = {};
  renderChips(state.sampleDoubts);
}

function renderChips(texts) {
  const chips = $("chips");
  chips.innerHTML = "";
  (texts || []).forEach((text) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const askBtn = document.createElement("button");
    askBtn.className = "chip-ask";
    askBtn.textContent = text;
    askBtn.addEventListener("click", () => ask(text));
    chip.appendChild(askBtn);
    chip.appendChild(makeSpeakButton(text, "Listen to this prompt"));
    chips.appendChild(chip);
  });
}

async function translateChips() {
  if (!state.sampleDoubts.length || state.selectedCase === "upload") return;
  const lang = $("language").value;
  if (lang === "unknown" || lang === "hi-IN" || lang === "en-IN") {
    renderChips(state.sampleDoubts);
    return;
  }
  if (state.translationsCache[lang]) { renderChips(state.translationsCache[lang]); return; }
  const res = await fetch("/api/translate-samples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: state.sampleDoubts, language_code: lang }),
  });
  const data = await res.json();
  if (data.translations) {
    state.translationsCache[lang] = data.translations;
    renderChips(data.translations);
  }
}

/* ---------- storyboard ---------- */

function renderBoard(data) {
  const story = data.story || {};
  $("board").classList.remove("hidden");

  // Patient summary — spoken too
  const summaryCard = $("summary-card");
  if (story.patient_summary) {
    const p = $("patient-summary");
    p.textContent = `👤 ${story.patient_summary}`;
    p.appendChild(makeSpeakButton(story.patient_summary, "Listen to the summary"));
    summaryCard.classList.remove("hidden");
  } else {
    summaryCard.classList.add("hidden");
  }

  // Lab ➜ Pill map — 🔊 sits AFTER everything on the card
  const links = $("lab-links");
  links.innerHTML = "";
  for (const lab of story.lab_links || []) {
    const card = document.createElement("div");
    card.className = `lab-card status-${lab.status || "normal"}`;

    const main = document.createElement("div");
    main.className = "lab-main";
    main.innerHTML = `
      <div class="lab-marker">${escapeHtml(lab.marker)}
        <span class="lab-value">${escapeHtml(lab.value)}</span></div>
      <div class="lab-range">ref ${escapeHtml(lab.reference_range || "—")}</div>`;
    card.appendChild(main);

    if (lab.linked_medicine) {
      const med = document.createElement("div");
      med.className = "lab-med";
      med.textContent = `➜ 💊 ${lab.linked_medicine}`;
      card.appendChild(med);
    }
    if (lab.plain_meaning) {
      const meaning = document.createElement("p");
      meaning.className = "lab-meaning";
      meaning.textContent = lab.plain_meaning;
      card.appendChild(meaning);
    }

    const spoken = [
      `${lab.marker}, ${lab.value}, ${lab.status || ""}.`,
      lab.reference_range ? `Reference range ${lab.reference_range}.` : "",
      lab.linked_medicine ? `Linked medicine ${lab.linked_medicine}.` : "",
      lab.plain_meaning || "",
    ].filter(Boolean).join(" ");
    const foot = document.createElement("div");
    foot.className = "card-foot";
    foot.appendChild(makeSpeakButton(spoken, "Listen to this result"));
    card.appendChild(foot);

    links.appendChild(card);
  }
  if (!(story.lab_links || []).length) {
    links.innerHTML = "<p class='muted'>No abnormal markers found in this report.</p>";
  }

  // Schedule cards — each slot head (name + when) gets a 🔊 after it
  const slots = { morning: "slot-morning", afternoon: "slot-afternoon", night: "slot-night" };
  for (const [key, id] of Object.entries(slots)) {
    const el = $(id);
    const slot = (story.schedule || {})[key] || { label: "", pills: [] };
    el.querySelector(".slot-label").textContent = slot.label || "";
    const head = el.querySelector(".slot-head");
    const oldBtn = head.querySelector(".icon-speak");
    if (oldBtn) oldBtn.remove();
    head.appendChild(makeSpeakButton(
      `${key[0].toUpperCase() + key.slice(1)}. ${slot.label || ""}`.trim(),
      "Listen to this slot"
    ));
    const pills = el.querySelector(".pills");
    pills.innerHTML = "";
    for (const pill of slot.pills || []) {
      pills.appendChild(renderPill(pill));
    }
    if (!(slot.pills || []).length) {
      pills.innerHTML = "<p class='pill-empty'>No medicine in this slot</p>";
    }
  }

  // Story
  $("story-text").textContent = story.story_script || "";
  $("play-story").classList.toggle("hidden", !data.audio_base64);

  // Guardrails
  const guard = $("guardrails");
  guard.innerHTML = "";
  for (const g of story.guardrails || []) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = g;
    li.appendChild(span);
    li.appendChild(makeSpeakButton(g, "Listen to this rule"));
    guard.appendChild(li);
  }
}

function renderPill(pill) {
  const div = document.createElement("div");
  div.className = "pill";
  const name = document.createElement("div");
  name.className = "pill-top";
  name.innerHTML = `<strong>💊 ${escapeHtml(pill.name)}</strong>`;
  div.appendChild(name);
  if (pill.instruction) {
    const inst = document.createElement("span");
    inst.textContent = pill.instruction;
    div.appendChild(inst);
  }
  if (pill.note) {
    const note = document.createElement("em");
    note.textContent = `⚠️ ${pill.note}`;
    div.appendChild(note);
  }
  // 🔊 AFTER everything the pill says
  const spoken = [pill.name, pill.instruction, pill.note].filter(Boolean).join(". ");
  const foot = document.createElement("div");
  foot.className = "card-foot";
  foot.appendChild(makeSpeakButton(spoken, "Listen to this medicine"));
  div.appendChild(foot);
  return div;
}

/* ---------- doubts ---------- */

async function askTyped() {
  const q = $("question").value.trim();
  if (!q) { flash($("doubt-status"), "Type a doubt or hold the mic.", true); return; }
  $("question").value = "";
  ask(q);
}

async function ask(question) {
  stopAudio();
  const status = $("doubt-status");
  flash(status, "Thinking with your report in hand…");
  $("answer").classList.add("hidden");
  try {
    const res = await fetch("/api/ask-doubt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: state.reportId, language_code: $("language").value, question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Doubt failed");
    renderAnswer(data);
    flash(status, "");
  } catch (err) {
    flash(status, `⚠️ ${err.message}`, true);
  }
}

function renderAnswer(data) {
  const a = data.answer || {};
  $("answer").classList.remove("hidden");

  const badge = $("safety-badge");
  const safetyLabel = {
    safe: "Safe action",
    caution: "Caution or timing adjustment",
    doctor: "Consult your doctor before changing anything",
  }[a.safety_level] || a.safety_level || "";
  badge.textContent = {
    safe: "✅ Safe action",
    caution: "⚠️ Caution / timing",
    doctor: "🚩 Consult doctor",
  }[a.safety_level] || a.safety_level;
  badge.className = `badge ${a.safety_level || "caution"}`;
  state.safetySpeak = safetyLabel;

  const checked = [a.checked_pill, a.checked_lab].filter(Boolean).join(" + ");
  state.checkedText = checked ? `Checked: ${checked}` : "";
  $("checked").textContent = state.checkedText;
  $("speak-checked").classList.toggle("hidden", !checked);

  // Voice chat auto-detect: surface what was heard, and aim every 🔊
  // button (and the auto-played answer) at the detected language.
  const langPill = $("detected-lang");
  if (data.detected_language && state.langNames[data.detected_language]) {
    langPill.classList.remove("hidden");
    langPill.textContent = `🌐 Heard in: ${state.langNames[data.detected_language]}`;
    state.activeLang = data.detected_language;
  } else {
    langPill.classList.add("hidden");
  }

  state.transcript = data.transcript || "";
  state.answerText = a.answer_text || "";
  $("transcript").textContent = `You asked: “${data.transcript}”`;
  $("answer-text").textContent = a.answer_text || "";

  const misRow = $("misconception-row");
  state.misconceptionText = a.misconception_spotted || "";
  misRow.classList.toggle("hidden", !state.misconceptionText);
  if (state.misconceptionText) {
    $("misconception").textContent = `Misconception spotted: ${state.misconceptionText}`;
  }

  $("tts-note").classList.toggle("hidden", data.tts_available);
  if (!data.tts_available) {
    $("tts-note").textContent = "Voice output isn't available for this language yet — showing text.";
  }

  // Auto-play the spoken answer: the whole point is zero-reading use.
  if (data.audio_base64) {
    audioCache.set(`${state.activeLang}|${state.answerText}`, `data:audio/mpeg;base64,${data.audio_base64}`);
    play(data.audio_base64);
  }
}

/* ---------- mic ---------- */

function setupMic() {
  const mic = $("mic");
  let stream = null;
  let stopRequested = false; // released before the recorder was ready

  const start = async (e) => {
    e.preventDefault();
    if (state.recorder && state.recorder.state === "recording") return; // held key repeat / double press
    if (!state.reportId) { flash($("doubt-status"), "Start a session first.", true); return; }
    stopRequested = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      flash($("doubt-status"), "Microphone blocked — type your doubt instead.", true);
      return;
    }
    state.chunks = [];
    state.recorder = new MediaRecorder(stream);
    state.recorder.ondataavailable = (ev) => state.chunks.push(ev.data);
    state.recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(state.chunks, { type: "audio/webm" });
      blobToBase64(blob).then((b64) => askAudio(b64));
    };
    state.recorder.start();
    if (stopRequested) { state.recorder.stop(); return; }
    mic.textContent = "⏺️ Listening… release";
    mic.classList.add("recording");
  };

  const stop = (e) => {
    e.preventDefault();
    if (!state.recorder || state.recorder.state !== "recording") { stopRequested = true; return; }
    state.recorder.stop();
    mic.textContent = "🎙️ Hold";
    mic.classList.remove("recording");
  };

  mic.addEventListener("pointerdown", start);
  mic.addEventListener("pointerup", stop);
  mic.addEventListener("pointerleave", (e) => {
    if (state.recorder && state.recorder.state === "recording") stop(e);
  });
  // Keyboard parity for hold-to-record: hold Enter/Space, release to send.
  mic.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") start(e);
  });
  mic.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") stop(e);
  });
}

async function askAudio(b64) {
  stopAudio();
  const status = $("doubt-status");
  flash(status, "Understanding what you said…");
  $("answer").classList.add("hidden");
  try {
    const res = await fetch("/api/ask-doubt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report_id: state.reportId,
        language_code: $("language").value,
        audio_base64: b64,
        audio_mime: "audio/webm",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Doubt failed");
    renderAnswer(data);
    flash(status, "");
  } catch (err) {
    flash(status, `⚠️ ${err.message}`, true);
  }
}

/* ---------- helpers ---------- */

function play(b64) {
  if (!b64) return;
  stopAudio();
  currentAudio = new Audio(`data:audio/mpeg;base64,${b64}`);
  currentAudio.play().catch(console.error);
}

function flash(el, msg, isError = false, speakIt = isError) {
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  // Errors talk too — but never re-speak the "voice unavailable" notice,
  // or a TTS failure would loop forever.
  if (speakIt && msg) speak(msg).catch(() => {});
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

init().catch(console.error);
