// Web Worker: runs the optional local models (text embeddings, speech recognition) in the visitor's browser with transformers.js.
// Nothing typed or spoken leaves the device through this file: the only requests are the downloads of the library (jsDelivr, pinned
// version) and of the model files (huggingface.co), and those requests carry no user content. Loaded only after the visitor opts in.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

env.allowLocalModels = false;
let threadsSet = false;
function setThreads(n) { // fewer threads = less memory (every thread has its own working memory); the page decides by device
  if (threadsSet) return;
  threadsSet = true;
  try { env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, n | 0 || 1)); } catch (_) { /* default */ }
}

const loaded = new Map(); // key -> Promise<pipeline>

function progress(id, what) {
  return (p) => {
    if (p.status === "progress" && p.total) self.postMessage({ id, type: "progress", what, file: p.file, loaded: p.loaded, total: p.total });
  };
}

function get(task, model, dtype, id) {
  const key = `${task}|${model}|${JSON.stringify(dtype)}`;
  if (!loaded.has(key)) loaded.set(key, pipeline(task, model, { dtype, progress_callback: progress(id, model) }).catch((e) => { loaded.delete(key); throw e; }));
  return loaded.get(key);
}

self.onmessage = async (ev) => {
  const { id, op } = ev.data;
  setThreads(ev.data.threads);
  try {
    if (op === "embed") {
      // texts -> one Float32Array of n x dim, L2-normalised (mean pooling)
      const { model, texts, batch = 32 } = ev.data;
      const fe = await get("feature-extraction", model, "q8", id);
      let out = null, dim = 0;
      for (let i = 0; i < texts.length; i += batch) {
        const t = await fe(texts.slice(i, i + batch), { pooling: "mean", normalize: true });
        dim = t.dims[1];
        if (!out) out = new Float32Array(texts.length * dim);
        out.set(t.data, i * dim);
        if (texts.length > batch) self.postMessage({ id, type: "progress", what: "embedding", loaded: Math.min(i + batch, texts.length), total: texts.length });
      }
      self.postMessage({ id, type: "done", vectors: out || new Float32Array(0), dim }, out ? [out.buffer] : []);
    } else if (op === "asr") {
      // audio: Float32Array, 16 kHz mono -> text
      const { model, audio, language } = ev.data;
      const asr = await get("automatic-speech-recognition", model, { encoder_model: "q8", decoder_model_merged: "q8" }, id);
      const r = await asr(audio, { language, task: "transcribe", chunk_length_s: 30 });
      self.postMessage({ id, type: "done", text: (r.text || "").trim() });
    } else {
      throw new Error("unknown op " + op);
    }
  } catch (e) {
    self.postMessage({ id, type: "error", message: String((e && e.message) || e) });
  }
};
