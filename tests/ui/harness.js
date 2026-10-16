// Boots index.html and its scripts in jsdom, with a <dialog> polyfill.
// Dev-only: jsdom is not a project dependency. See tests/ui/README.md.
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const ROOT = path.resolve(__dirname, "../..");

function boot({ storage = {}, url = "http://localhost/index.html", errors = [] } = {}) {
  let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  html = html.replace(/<link[^>]+fonts[^>]*>/g, "").replace(/<link rel="preconnect"[^>]*>/g, "");
  html = html.replace(/<script src="([^"]+)"( defer)?><\/script>/g, (_, src) =>
    `<script>${fs.readFileSync(path.join(ROOT, src), "utf8").replace(/<\/script>/g, "<\\/script>")}\n//# sourceURL=${src}</script>`);
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message + (e.detail ? ` ${e.detail.stack || e.detail}` : "")));
  vc.on("error", (e) => errors.push(String(e)));
  vc.on("warn", () => {});
  const dom = new JSDOM(html, {
    url, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
      const D = w.HTMLDialogElement.prototype;
      D.showModal = function () { this.open = true; this.setAttribute("open", ""); };
      D.show = D.showModal;
      D.close = function (v) {
        if (!this.open) return;
        if (v !== undefined) this.returnValue = v;
        this.open = false; this.removeAttribute("open");
        this.dispatchEvent(new w.Event("close"));
      };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.BroadcastChannel = w.BroadcastChannel || class { postMessage() {} close() {} set onmessage(f) {} addEventListener() {} };
      w.requestAnimationFrame = (f) => setTimeout(f, 0);
      w.open = () => null;
      w.URL.createObjectURL = () => "blob:x";
      w.URL.revokeObjectURL = () => {};
    },
  });
  const w = dom.window;
  const $ = (s, r = w.document) => r.querySelector(s);
  const $$ = (s, r = w.document) => Array.from(r.querySelectorAll(s));
  const click = (el) => {
    if (typeof el === "string") { const e = $(el); if (!e) throw new Error(`no element ${el}`); el = e; }
    el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  };
  const setVal = (el, v, ev = "change") => {
    if (typeof el === "string") el = $(el);
    el.value = v;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
    if (ev === "change") el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  const key = (k, opts = {}, target = w.document) =>
    target.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
  const saved = (k = "dm-dashboard-state-v2") => JSON.parse(w.localStorage.getItem(k) || "null");
  const toasts = () => $$("#toast-stack .toast").map((t) => t.textContent.trim());
  return { dom, w, $, $$, click, setVal, key, tick, saved, toasts, errors };
}

function assert(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }

module.exports = { boot, assert, ROOT };
// The app's clock interval keeps Node alive, so scripts exit explicitly; this catches hangs.
setTimeout(() => { console.error("Timed out"); process.exit(2); }, Number(process.env.WATCHDOG || 180000)).unref();
