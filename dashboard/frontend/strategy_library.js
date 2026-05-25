// ---- Strategy library (localStorage) ----
//
// Espone window.strategyLibrary con: list(), get(name), save(name, strategy),
// remove(name), exportAll(), importAll(json) e una semplice subscribe() per
// notificare i tab di cambiamenti.

(function () {
  const KEY = "tv-strategy-library-v1";
  const listeners = new Set();

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (e) {
      return {};
    }
  }

  function writeAll(map) {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch (e) { /* ignora quota */ }
    listeners.forEach((cb) => {
      try { cb(); } catch (e) { /* no-op */ }
    });
  }

  function list() {
    return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
  }

  function get(name) {
    const map = readAll();
    return map[name] || null;
  }

  function save(name, strategy) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Nome strategia vuoto.");
    if (!strategy || typeof strategy !== "object") {
      throw new Error("La strategia deve essere un oggetto JSON.");
    }
    const map = readAll();
    map[trimmed] = strategy;
    writeAll(map);
  }

  function remove(name) {
    const map = readAll();
    if (!(name in map)) return false;
    delete map[name];
    writeAll(map);
    return true;
  }

  function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  // Reagisci ai cambiamenti fatti in altri tab del browser
  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY) {
      listeners.forEach((cb) => { try { cb(); } catch (e) {} });
    }
  });

  window.strategyLibrary = { list, get, save, remove, subscribe };

  // Helper condiviso: estrae un messaggio leggibile da una risposta di errore
  // FastAPI/Pydantic. `detail` può essere una stringa o un array di validation
  // error (Pydantic v2): [{loc, msg, type}, ...].
  function formatApiError(payload, status) {
    if (!payload || typeof payload !== "object") return `HTTP ${status}`;
    const d = payload.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d.map((e) => {
        if (!e || typeof e !== "object") return String(e);
        const loc = Array.isArray(e.loc) ? e.loc.filter((p) => p !== "body").join(".") : "";
        const msg = e.msg || e.type || "errore di validazione";
        return loc ? `${loc}: ${msg}` : msg;
      }).join(" | ");
    }
    if (d && typeof d === "object") {
      try { return JSON.stringify(d); } catch (e) { return `HTTP ${status}`; }
    }
    return `HTTP ${status}`;
  }
  window.formatApiError = formatApiError;
})();
