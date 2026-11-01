/* Ghar Ka Doctor — frontend logic (vanilla JS, no build step) */

const $ = (id) => document.getElementById(id);

const state = {
  reportId: null,
  currentPreset: "case-a",
  sampleDoubts: [],
  translationsCache: {}, // language_code -> [translated doubts]
  storyAudio: null,
  transcript: "",
  answerText: "",
  activeLang: "hi-IN", // concrete language used by all 🔊 buttons
  langNames: {}, // code -> "Tamil (தமிழ்)"
  recorder: null,
  chunks: [],
};

/* ---------- audio everywhere ----------
   One shared helper: every 🔊 button on the page speaks its text via
   POST /api/speak, cached per (language, text) so nothing is asked twice. */

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
  if (playingBtn === btn) { stopAudio(); return; } // toggle off
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
    flash($("doubt-status"), "Voice isn't available for this language — showing text.", true);
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
  btn.addEventListener("click", () => speak(text, btn));
  return btn;
}

/* ---------- init ---------- */

async function init() {
  await loadLanguages();
  loadSampleDoubts(state.currentPreset);

  $("preset").addEventListener("change", () => {
    state.currentPreset = $("preset").value;
    $("file-field").classList.toggle("hidden", state.currentPreset !== "upload");
    if (state.currentPreset !== "upload") loadSampleDoubts(state.currentPreset);
  });
  $("file").addEventListener("change", () => {
    const f = $("file").files[0];
    const label = $("file-name");
    label.textContent = f ? `📄 ${f.name}` : "Click to choose a photo or PDF";
    label.parentElement.classList.toggle("has-file", !!f);
  });
  $("language").addEventListener("change", () => {
    stopAudio();
    if ($("language").value !== "unknown") state.activeLang = $("language").value;
    translateChips().catch(console.error);
  });
  $("analyze").addEventListener("click", analyze);
  $("ask").addEventListener("click", askTyped);
  $("question").addEventListener("keydown", (e) => { if (e.key === "Enter") askTyped(); });
  $("play-story").addEventListener("click", () => play(state.storyAudio));
  $("speak-transcript").addEventListener("click", () => speak(state.transcript, $("speak-transcript")));
  $("speak-answer").addEventListener("click", () => speak(state.answerText, $("speak-answer")));
  setupMic();
}

async function loadLanguages() {
  const res = await fetch("/api/languages");
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
  // Voice chat: let Saaras auto-detect the spoken language.
  const auto = document.createElement("option");
  auto.value = "unknown";
  auto.textContent = "🌐 Auto-detect — speak in any language";
  sel.insertBefore(auto, sel.firstChild);
  sel.value = data.default;
}

async function loadSampleDoubts(presetId) {
  const res = await fetch("/api/presets");
  const presets = await res.json();
  const preset = presets.find((p) => p.id === presetId);
  state.sampleDoubts = preset ? preset.sample_doubts : [];
  state.translationsCache = {};
  renderChips(state.sampleDoubts);
}

/* ---------- storyboard ---------- */

async function analyze() {
  const btn = $("analyze");
  const status = $("setup-status");
  btn.disabled = true;
  flash(status, "Reading the report…");

  try {
    const fd = new FormData();
    fd.append("language_code", $("language").value);
    if (state.currentPreset === "upload") {
      const file = $("file").files[0];
      if (!file) { flash(status, "Choose a report photo or PDF first.", true); return; }
      fd.append("file", file);
    } else {
      fd.append("preset_id", state.currentPreset);
    }

    const res = await fetch("/api/analyze-report", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Analysis failed");

    state.reportId = data.report_id;
    state.storyAudio = data.audio_base64;
    renderBoard(data);
    $("board").scrollIntoView({ behavior: "smooth", block: "start" });
    flash(status, "Storyboard ready — ask your doubts below.");
    translateChips().catch(console.error);
  } catch (err) {
    flash(status, `⚠️ ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

function renderBoard(data) {
  const story = data.story || {};
  $("board").classList.remove("hidden");

  // Lab ➜ Pill map
  const links = $("lab-links");
  links.innerHTML = "";
  for (const lab of story.lab_links || []) {
    const card = document.createElement("div");
    card.className = `lab-card status-${lab.status || "normal"}`;

    const top = document.createElement("div");
    top.className = "lab-top";

    const main = document.createElement("div");
    main.className = "lab-main";
    main.innerHTML = `
      <div class="lab-marker">${escapeHtml(lab.marker)}
        <span class="lab-value">${escapeHtml(lab.value)}</span></div>
      <div class="lab-range">ref ${escapeHtml(lab.reference_range || "—")}</div>`;
    top.appendChild(main);
    if (lab.plain_meaning) top.appendChild(makeSpeakButton(lab.plain_meaning, "Explain this result"));
    card.appendChild(top);

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
    links.appendChild(card);
  }
  if (!(story.lab_links || []).length) {
    links.innerHTML = "<p class='muted'>No abnormal markers found in this report.</p>";
  }

  // Schedule cards
  const slots = { morning: "slot-morning", afternoon: "slot-afternoon", night: "slot-night" };
  for (const [key, id] of Object.entries(slots)) {
    const el = $(id);
    const slot = (story.schedule || {})[key] || { label: "", pills: [] };
    el.querySelector(".slot-label").textContent = slot.label || "";
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
  const top = document.createElement("div");
  top.className = "pill-top";
  const name = document.createElement("strong");
  name.textContent = `💊 ${pill.name}`;
  top.appendChild(name);
  const spoken = [pill.name, pill.instruction, pill.note].filter(Boolean).join(". ");
  top.appendChild(makeSpeakButton(spoken, "Listen to this medicine"));
  div.appendChild(top);
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
  return div;
}

/* ---------- doubts ---------- */

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
  if (!state.sampleDoubts.length || state.currentPreset === "upload") return;
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
  badge.textContent = {
    safe: "✅ Safe action",
    caution: "⚠️ Caution / timing",
    doctor: "🚩 Consult doctor",
  }[a.safety_level] || a.safety_level;
  badge.className = `badge ${a.safety_level || "caution"}`;

  const checked = [a.checked_pill, a.checked_lab].filter(Boolean).join(" + ");
  $("checked").textContent = checked ? `Checked: ${checked}` : "";

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
  $("transcript").textContent = `You asked: "${data.transcript}"`;
  $("answer-text").textContent = a.answer_text || "";

  const mis = $("misconception");
  mis.classList.toggle("hidden", !a.misconception_spotted);
  if (a.misconception_spotted) mis.textContent = `Misconception spotted: ${a.misconception_spotted}`;

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

  const start = async (e) => {
    e.preventDefault();
    if (!state.reportId) { flash($("doubt-status"), "Generate a storyboard first.", true); return; }
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
    mic.textContent = "⏺️ Listening… release";
    mic.classList.add("recording");
  };

  const stop = (e) => {
    e.preventDefault();
    if (state.recorder && state.recorder.state === "recording") state.recorder.stop();
    mic.textContent = "🎙️ Hold";
    mic.classList.remove("recording");
  };

  mic.addEventListener("pointerdown", start);
  mic.addEventListener("pointerup", stop);
  mic.addEventListener("pointerleave", (e) => {
    if (state.recorder && state.recorder.state === "recording") stop(e);
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

function flash(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
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
