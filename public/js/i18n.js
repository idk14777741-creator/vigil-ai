/**
 * VIGIL AI — Multilingual & Inclusive Support (classic script).
 *
 * Language is a communication preference only. It NEVER changes scores,
 * permissions, data, or role — the same Recovery Score, Stress Score and
 * Fatigue Risk are computed and shown identically in every language.
 *
 * Architecture:
 *   - Centralized t(key) lookup with graceful English fallback (never shows
 *     raw keys or "undefined").
 *   - LANGUAGES is the single registry: adding a language = add an entry +
 *     a resource object. No app restructuring.
 *   - Preference persists on the server profile (language_preference) and
 *     mirrors to localStorage for instant paint before /api/me returns.
 *   - AI conversation language is handled server-side (ai_provider.py) using
 *     the same language codes; static UI never uses the AI for translation.
 */
(function (V) {
  const STORAGE_KEY = "vigil-language";

  const LANGUAGES = {
    en:       { code: "en",       name: "English",  native: "English" },
    hi:       { code: "hi",       name: "Hindi",    native: "हिन्दी" },
    hinglish: { code: "hinglish", name: "Hinglish", native: "Hinglish" },
    mr:       { code: "mr",       name: "Marathi",  native: "मराठी" },
    ta:       { code: "ta",       name: "Tamil",    native: "தமிழ்" },
    bn:       { code: "bn",       name: "Bengali",  native: "বাংলা" },
    pa:       { code: "pa",       name: "Punjabi",  native: "ਪੰਜਾਬੀ" },
    as:       { code: "as",       name: "Assamese", native: "অসমীয়া" },
  };

  const RESOURCES = {};
  // English is the complete fallback resource; registered by i18n_en.js.
  // Other languages (i18n_<code>.js) may be partial — missing keys fall back
  // to English automatically.

  let current = "en";
  const listeners = [];

  function resolve(code) {
    return LANGUAGES[code] ? code : "en";
  }

  /**
   * Translate a key in the current language. Missing keys fall back to
   * English; missing there too, fall back to the key's last segment
   * prettified — we never render a raw dotted key or "undefined".
   */
  function t(key, vars) {
    let s = lookup(key);
    if (s === null) {
      const leaf = String(key).split(".").pop().replace(/_/g, " ");
      s = leaf.charAt(0).toUpperCase() + leaf.slice(1);
    }
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function lookup(key) {
    const res = RESOURCES[current];
    if (res && typeof res[key] === "string") return res[key];
    const en = RESOURCES.en;
    if (en && typeof en[key] === "string") return en[key];
    return null;
  }

  function getLanguage() { return current; }

  function setLanguage(code, opts) {
    code = resolve(code);
    if (code === current) return Promise.resolve(code);
    current = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* private mode */ }
    applyDocumentLang();
    listeners.forEach(function (fn) { try { fn(code); } catch (e) { /* noop */ } });
    // Persist on the profile (server) unless asked not to (e.g. login screen).
    if (!(opts && opts.skipPersist)) {
      return V.API.endpoints.updateMe({ language_preference: code })
        .then(function () { return code; })
        .catch(function () { return code; }); // offline-tolerant; localStorage still holds it
    }
    return Promise.resolve(code);
  }

  function applyDocumentLang() {
    document.documentElement.setAttribute("lang", current === "hinglish" ? "hi-Latn" : current);
  }

  function onChange(fn) { listeners.push(fn); }

  /** Restore preference: localStorage first (instant), then profile wins. */
  function init(profileLang) {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* noop */ }
    current = resolve(profileLang || saved || "en");
    applyDocumentLang();
  }

  /** BCP47 tag for locale-aware date/time formatting (Intl). */
  const LOCALE_TAGS = { en: "en-IN", hi: "hi-IN", hinglish: "en-IN", mr: "mr-IN", ta: "ta-IN", bn: "bn-IN", pa: "pa-IN", as: "as-IN" };

  function locale() { return LOCALE_TAGS[current] || "en-IN"; }

  /** Locale-aware date format: FRIDAY 25 SEPTEMBER → शुक्रवार 25 सितंबर. */
  function fmtDate(date, opts) {
    try { return new Date(date).toLocaleDateString(locale(), opts); }
    catch (e) { return new Date(date).toLocaleDateString(undefined, opts); }
  }

  function fmtTime(date) {
    try { return new Date(date).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return new Date(date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  }

  /** Relative time from the translation resources. */
  function timeAgo(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return t("time.minsAgo", { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("time.hoursAgo", { n: hrs });
    const days = Math.floor(hrs / 24);
    if (days < 7) return t("time.daysAgo", { n: days });
    return fmtDate(iso, { month: "short", day: "numeric" });
  }

  /** Native-script option list for <select> or picker UIs. */
  function optionsHtml(selected) {
    return Object.keys(LANGUAGES).map(function (code) {
      const l = LANGUAGES[code];
      return '<option value="' + code + '"' + (code === selected ? " selected" : "") + ">" +
        l.native + "</option>";
    }).join("");
  }

  /** Honest AI conversational support note per language (UI copy, not data). */
  const AI_SUPPORT = {
    en: "Full conversational support.",
    hi: "Conversational support depends on the configured AI model.",
    hinglish: "Conversational Hinglish supported by the configured AI model.",
    mr: "Conversational support depends on the configured AI model.",
    ta: "Conversational support depends on the configured AI model.",
    bn: "Conversational support depends on the configured AI model.",
    pa: "Conversational support depends on the configured AI model.",
    as: "Conversational support depends on the configured AI model.",
  };

  V.I18N = {
    t: t, LANGUAGES: LANGUAGES, RESOURCES: RESOURCES,
    getLanguage: getLanguage, setLanguage: setLanguage,
    init: init, onChange: onChange, optionsHtml: optionsHtml,
    locale: locale, fmtDate: fmtDate, fmtTime: fmtTime, timeAgo: timeAgo,
    aiSupportNote: function (code) { return AI_SUPPORT[resolve(code)] || AI_SUPPORT.en; },
  };
})(window.VIGIL = window.VIGIL || {});
