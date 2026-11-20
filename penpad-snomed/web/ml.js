// Optional local models in the browser: semantic search (text embeddings) and speech recognition. Everything is computed on the visitor's
// device in a Web Worker (mlworker.js). The models are chosen by measurement (docs/browser-ml.md): multilingual-e5-small for the search
// (MIT), KB-Whisper for Swedish speech and Whisper for English (Apache-2.0).

export const EMBED_MODEL = "Xenova/multilingual-e5-small";
export const ASR_MODELS = { sv: "KBLab/kb-whisper-base", en: "Xenova/whisper-base" };
export const ASR_SMALL = { sv: "KBLab/kb-whisper-tiny", en: "Xenova/whisper-tiny" }; // for phones and other devices with little memory
export const DOWNLOAD_MB = { embed: 118, asr: { sv: 181, en: 76 }, asrSmall: { sv: 119, en: 40 } };

/** Phones, tablets and devices that say they have 4 GB or less: the browser closes a tab that uses too much memory, so use less. */
export function lowMemory(nav = typeof navigator !== "undefined" ? navigator : {}) {
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return true;
  const ua = nav.userAgent || "";
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (nav.maxTouchPoints > 1 && /Macintosh/.test(ua)); // iPadOS says "Macintosh"
}
export const asrModel = (lang, low = lowMemory()) => (low ? ASR_SMALL : ASR_MODELS)[lang] || (low ? ASR_SMALL : ASR_MODELS).en;
export const asrMB = (lang, low = lowMemory()) => (low ? DOWNLOAD_MB.asrSmall : DOWNLOAD_MB.asr)[lang] || (low ? DOWNLOAD_MB.asrSmall : DOWNLOAD_MB.asr).en;
const threads = () => (lowMemory() ? 1 : Math.min(4, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2));
export const LIB_VERSION = "4.3.2"; // must match the import in mlworker.js (tests/ml.test.mjs checks it)
const DTYPE = "q8";
const PREFIX = "query: "; // e5 wants a prefix; "query:" on both sides measured better than query/passage for short term names

// ------------------------------------------------------------------------------------------------ pure parts (unit tested)
/** Best cosine per concept. matrix: n x dim (L2-normalised rows), codes: concept of each row. Returns [{code, cos}] best first. */
export function rankConcepts(qvec, matrix, dim, codes, k = 30) {
  const best = new Map();
  for (let i = 0; i < codes.length; i++) {
    let s = 0;
    const o = i * dim;
    for (let j = 0; j < dim; j++) s += qvec[j] * matrix[o + j];
    const c = codes[i];
    if (!best.has(c) || s > best.get(c)) best.set(c, s);
  }
  return [...best.entries()].map(([code, cos]) => ({ code, cos })).sort((a, b) => b.cos - a.cos || (a.code < b.code ? -1 : 1)).slice(0, k);
}

/** Reciprocal-rank fusion of ranked code lists; a code missing from a list gets nothing from it. */
export function fuseRanks(lists, depth = 50) {
  const score = new Map();
  for (const list of lists) list.slice(0, depth).forEach((code, pos) => score.set(code, (score.get(code) || 0) + 1 / (60 + pos)));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([code]) => code);
}

/** Names to embed for a universe of rows [code, en, sv, topic]: [{code, text}] (English and Swedish, no duplicates per concept). */
export function namesOf(rows) {
  const out = [];
  for (const [code, en, sv] of rows) {
    if (en) out.push({ code, text: en });
    if (sv && sv !== en) out.push({ code, text: sv });
  }
  return out;
}

/** Linear resampling of mono audio to 16 kHz (used when the browser cannot do it for us). */
export function resampleLinear(samples, fromRate, toRate = 16000) {
  if (fromRate === toRate) return samples;
  const n = Math.max(1, Math.round(samples.length * toRate / fromRate));
  const out = new Float32Array(n);
  const step = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const x = i * step, i0 = Math.floor(x), i1 = Math.min(samples.length - 1, i0 + 1), f = x - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

/** Tidy a transcript for the text box: one line, no final full stop, no surrounding quotes. */
export function tidyTranscript(t) {
  return String(t || "").replace(/\s+/g, " ").trim().replace(/^["'«»]+|["'«»]+$/g, "").replace(/[.!?…]+$/u, "").trim();
}

// ------------------------------------------------------------------------------------------------ worker plumbing
// One worker per kind of model, and only one model in memory at a time: the embedding worker is stopped before speech recognition starts
// and after 20 s without use, the speech worker as soon as it has answered. (Both together took 2.3 GB; a phone closes the tab long before.)
const workers = { embed: null, asr: null };
const idle = { embed: null };
let nextId = 1;
const pending = new Map();

function release(kind, reason = "released") {
  const w = workers[kind];
  workers[kind] = null;
  clearTimeout(idle[kind]);
  if (w) w.terminate();
  for (const [id, p] of pending) if (p.kind === kind) { clearTimeout(p.timer); pending.delete(id); p.reject(new Error(reason)); }
}
export function releaseAll() { release("embed"); release("asr"); }

function call(kind, msg, onProgress, transfer = [], timeoutMs = 15 * 60 * 1000) {
  if (!workers[kind]) {
    const w = new Worker(new URL("./mlworker.js", import.meta.url), { type: "module" });
    workers[kind] = w;
    w.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      if (ev.data.type === "progress") { if (p.onProgress) p.onProgress(ev.data); return; }
      pending.delete(ev.data.id);
      clearTimeout(p.timer);
      if (ev.data.type === "done") p.resolve(ev.data); else p.reject(new Error(ev.data.message || "worker error"));
    };
    w.onerror = (e) => release(kind, e.message || "the model worker failed to load");
    w.onmessageerror = () => release(kind, "the model worker sent something unreadable");
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // a download that hangs must not leave the page waiting for ever
    const timer = setTimeout(() => { if (pending.has(id)) release(kind, "the model did not answer in time"); }, timeoutMs);
    pending.set(id, { resolve, reject, onProgress, timer, kind });
    workers[kind].postMessage({ id, threads: threads(), ...msg }, transfer);
  });
}

export async function embed(texts, onProgress) {
  release("asr"); // never both models at once
  try {
    const r = await call("embed", { op: "embed", model: EMBED_MODEL, texts: texts.map((t) => PREFIX + t) }, onProgress);
    return { vectors: r.vectors, dim: r.dim };
  } finally {
    clearTimeout(idle.embed);
    idle.embed = setTimeout(() => release("embed"), 20000); // the vectors of the names stay in the page; the model leaves memory when not in use
  }
}

// ------------------------------------------------------------------------------------------------ semantic index (with a cache in the browser)
const DB = "penpad-ml", STORE = "vectors";
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function cacheGet(key) {
  try { const db = await idb(); return await new Promise((res) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch (_) { return null; }
}
async function cachePut(key, value) {
  try { const db = await idb(); await new Promise((res) => { const tx = db.transaction(STORE, "readwrite"); const st = tx.objectStore(STORE); st.clear(); st.put(value, key); /* one index at a time: older ones are dropped */ tx.oncomplete = res; tx.onerror = res; }); }
  catch (_) { /* no cache: the index is rebuilt next time */ }
}
async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

let index = null; // {codes, matrix, dim}

/** Embed every name of the universe once (cached in this browser's IndexedDB; the vectors never leave the device). */
export async function buildIndex(rows, onProgress) {
  const names = namesOf(rows);
  const key = `${EMBED_MODEL}|${DTYPE}|${PREFIX}|${LIB_VERSION}|${await sha(names.map((n) => n.code + "\t" + n.text).join("\n"))}`; // everything the vectors depend on
  const hit = await cacheGet(key);
  if (hit && hit.dim && hit.matrix && hit.matrix.length === names.length * hit.dim) index = { codes: names.map((n) => n.code), matrix: hit.matrix, dim: hit.dim };
  else {
    const { vectors, dim } = await embed(names.map((n) => n.text), onProgress);
    index = { codes: names.map((n) => n.code), matrix: vectors, dim };
    await cachePut(key, { matrix: vectors, dim });
  }
  return { names: names.length, concepts: new Set(index.codes).size };
}

export const indexReady = () => !!index;

/** Concepts whose names are closest in meaning to the text: [{code, cos}], best first. */
export async function semanticSearch(text, k = 30) {
  if (!index) throw new Error("no index");
  const { vectors } = await embed([text]);
  return rankConcepts(vectors, index.matrix, index.dim, index.codes, k);
}

// ------------------------------------------------------------------------------------------------ speech
/** Encoded audio (what the recorder or a file gives) -> 16 kHz mono Float32Array. */
export async function decodeTo16k(arrayBuffer) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
    return resampleLinear(mono, buf.sampleRate, 16000);
  } finally { ctx.close(); }
}

export async function transcribe(audio16k, lang, onProgress) {
  release("embed"); // never both models at once: speech recognition is the heavier one
  try {
    const r = await call("asr", { op: "asr", model: asrModel(lang), audio: audio16k, language: lang === "sv" ? "swedish" : "english" }, onProgress);
    return tidyTranscript(r.text);
  } finally {
    release("asr"); // the files stay in the browser's cache; the memory is given back at once
  }
}

/** Microphone recorder: start() -> {stop(): Promise<Float32Array 16 kHz>}. The sound stays in this page. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  let rec;
  try { rec = new MediaRecorder(stream); } catch (e) { release(); throw e; } // never leave the microphone open
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    cancel: () => { try { rec.onstop = null; if (rec.state !== "inactive") rec.stop(); } finally { release(); } },
    stop: () => new Promise((resolve, reject) => {
      rec.onstop = async () => {
        release();
        try { resolve(await decodeTo16k(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer())); } catch (e) { reject(e); }
      };
      rec.onerror = (e) => { release(); reject(e.error || new Error("recording failed")); };
      if (rec.state === "inactive") { release(); reject(new Error("the recording had already stopped")); } else rec.stop();
    }),
  };
}
