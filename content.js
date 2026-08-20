(() => {
  const ROOT_ID = "edge-touch-bar-root";
  const STYLE_ID = "edge-touch-bar-styles";
  const RECENT_HISTORY_KEY = "recentHistory";
  const MAX_RECENT_ITEMS = 240;
  const MAX_SUGGESTIONS = 8;
  const HISTORY_DEBOUNCE_MS = 500;
  const DEFAULT_SETTINGS = {
    enabled: true,
    dictionary: "english"
  };
  const DICTIONARY_FILES = {
    english: "dictionaries/english.json",
    html: "dictionaries/html.json",
    python: "dictionaries/python.json"
  };

  let dictionaries = {};
  let recentHistory = [];
  let currentSuggestions = [];
  let settings = { ...DEFAULT_SETTINGS };
  let root;
  let input;
  let suggestions;
  let snippetPanel;
  let expandButton;
  let modeBadge;
  let shortcutHint;
  let lastEditable = null;
  let expanded = false;
  let historyTimer = null;

  const isEditable = (element) => {
    if (!element || element === input) {
      return false;
    }

    const tagName = element.tagName?.toLowerCase();
    const blockedInputTypes = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
    return element.isContentEditable || tagName === "textarea" || (tagName === "input" && !blockedInputTypes.includes(element.type));
  };

  const activeDict = () => dictionaries[settings.dictionary] || dictionaries.english || { label: "English", words: [], snippets: [] };

  const normalizeDictionary = (key, dictionary) => {
    const source = Array.isArray(dictionary) ? { words: dictionary } : dictionary || {};

    return {
      label: source.label || key[0].toUpperCase() + key.slice(1),
      words: Array.isArray(source.words) ? source.words : [],
      snippets: Array.isArray(source.snippets) ? source.snippets : []
    };
  };

  const getMeta = () => Object.fromEntries(
    Object.entries(dictionaries).map(([key, value]) => [
      key,
      {
        label: value.label || key[0].toUpperCase() + key.slice(1),
        words: value.words.length,
        snippets: value.snippets.length
      }
    ])
  );

  const getEditableText = (element) => {
    if (!element) {
      return "";
    }

    if (element.isContentEditable) {
      return element.textContent || "";
    }

    return element.value || "";
  };

  const getCurrentQuery = () => input.value.trim().toLowerCase().split(/\s+/).pop() || "";

  const normalizeHistoryTerm = (text) => text.trim().replace(/\s+/g, " ");

  const extractHistoryTerms = (text) => {
    const normalized = normalizeHistoryTerm(text);
    if (!normalized) {
      return [];
    }

    const words = normalized
      .split(/[^\p{L}\p{N}_#.+<>/-]+/u)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2 && word.length <= 60);
    const tailPhrase = normalized.split(/\s+/).slice(-5).join(" ");

    return [...new Set([...words, tailPhrase].filter((term) => term.length >= 2 && term.length <= 120))];
  };

  const saveRecentHistory = () => {
    chrome.storage.local.set({ [RECENT_HISTORY_KEY]: recentHistory.slice(0, MAX_RECENT_ITEMS) });
  };

  const rememberTerms = (terms) => {
    const now = Date.now();
    let changed = false;

    for (const rawTerm of terms) {
      const term = normalizeHistoryTerm(rawTerm);
      if (!term) {
        continue;
      }

      const existing = recentHistory.find((item) => item.text.toLowerCase() === term.toLowerCase());
      if (existing) {
        existing.count += 1;
        existing.lastUsed = now;
      } else {
        recentHistory.push({ text: term, count: 1, lastUsed: now });
      }
      changed = true;
    }

    if (!changed) {
      return;
    }

    recentHistory.sort((a, b) => b.lastUsed - a.lastUsed);
    recentHistory = recentHistory.slice(0, MAX_RECENT_ITEMS);
    saveRecentHistory();
  };

  const scheduleRememberFromElement = (element) => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      rememberTerms(extractHistoryTerms(getEditableText(element)));
      renderSuggestions();
    }, HISTORY_DEBOUNCE_MS);
  };

  const loadLocalDictionaries = async () => {
    const entries = await Promise.all(
      Object.entries(DICTIONARY_FILES).map(async ([key, path]) => {
        const response = await fetch(chrome.runtime.getURL(path));
        if (!response.ok) {
          throw new Error(`Unable to load ${path}`);
        }
        return [key, normalizeDictionary(key, await response.json())];
      })
    );
    return Object.fromEntries(entries);
  };

  const loadDictionaries = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_DICTIONARIES" });
      if (response?.dictionaries && Object.keys(response.dictionaries).length > 0) {
        dictionaries = Object.fromEntries(
          Object.entries(response.dictionaries).map(([key, dictionary]) => [key, normalizeDictionary(key, dictionary)])
        );
        return;
      }
    } catch {
      // Fall back to bundled dictionaries if the service worker cannot respond.
    }

    dictionaries = await loadLocalDictionaries();
  };

  const loadRecentHistory = async () => {
    const stored = await chrome.storage.local.get({ [RECENT_HISTORY_KEY]: [] });
    recentHistory = Array.isArray(stored[RECENT_HISTORY_KEY]) ? stored[RECENT_HISTORY_KEY] : [];
  };

  const dispatchInputEvents = (element) => {
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const replaceCurrentToken = (element, value) => {
    const currentValue = element.value || "";
    const cursor = element.selectionStart ?? currentValue.length;
    const before = currentValue.slice(0, cursor);
    const after = currentValue.slice(element.selectionEnd ?? cursor);
    const tokenStart = before.search(/\S+$/);
    const prefix = tokenStart >= 0 ? before.slice(0, tokenStart) : before;
    const nextValue = `${prefix}${value}${after}`;
    const nextPosition = prefix.length + value.length;

    element.value = nextValue;
    element.setSelectionRange(nextPosition, nextPosition);
    element.focus();
    dispatchInputEvents(element);
  };

  const insertIntoElement = (element, value, { replaceToken = false } = {}) => {
    if (!element) {
      if (replaceToken) {
        replaceCurrentToken(input, value);
      } else {
        input.value += value;
      }
      input.focus();
      renderSuggestions();
      return;
    }

    if (element.isContentEditable) {
      element.focus();
      document.execCommand("insertText", false, value);
      dispatchInputEvents(element);
      return;
    }

    if (replaceToken) {
      replaceCurrentToken(element, value);
      return;
    }

    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    element.value = `${element.value.slice(0, start)}${value}${element.value.slice(end)}`;
    const nextPosition = start + value.length;
    element.setSelectionRange(nextPosition, nextPosition);
    element.focus();
    dispatchInputEvents(element);
  };

  const applyValue = (value, options = {}) => {
    const target = lastEditable && document.contains(lastEditable) ? lastEditable : null;
    insertIntoElement(target, value, options);
    rememberTerms([value]);

    if (!target) {
      input.value = value;
      input.focus();
      renderSuggestions();
    }
  };

  const getRankedSuggestions = (query) => {
    if (!query) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const seen = new Set();
    const recentMatches = recentHistory
      .filter((item) => item.text.toLowerCase().startsWith(lowerQuery) && item.text.toLowerCase() !== lowerQuery)
      .sort((a, b) => (b.count - a.count) || (b.lastUsed - a.lastUsed))
      .map((item) => ({ text: item.text, source: "recent" }));

    const dictionaryMatches = activeDict().words
      .filter((word) => word.toLowerCase().startsWith(lowerQuery) && word.toLowerCase() !== lowerQuery)
      .map((word) => ({ text: word, source: "dict" }));

    return [...recentMatches, ...dictionaryMatches]
      .filter((item) => {
        const key = item.text.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, MAX_SUGGESTIONS);
  };

  const renderSuggestions = () => {
    if (!suggestions) {
      return;
    }

    currentSuggestions = getRankedSuggestions(getCurrentQuery());
    suggestions.innerHTML = "";
    suggestions.hidden = currentSuggestions.length === 0;
    shortcutHint.hidden = currentSuggestions.length === 0;

    currentSuggestions.forEach((match, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "edge-touch-bar__suggestion";
      button.dataset.source = match.source;
      button.title = `Alt+${index + 1}`;
      button.innerHTML = `<span class="edge-touch-bar__shortcut">${index + 1}</span><span class="edge-touch-bar__suggestion-text"></span>`;
      button.querySelector(".edge-touch-bar__suggestion-text").textContent = match.text;
      button.addEventListener("click", () => applyValue(match.text, { replaceToken: true }));
      suggestions.append(button);
    });
  };

  const renderSnippets = () => {
    if (!snippetPanel) {
      return;
    }

    snippetPanel.innerHTML = "";

    for (const snippet of activeDict().snippets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "edge-touch-bar__snippet";
      button.textContent = snippet;
      button.title = snippet;
      button.addEventListener("click", () => applyValue(snippet));
      snippetPanel.append(button);
    }
  };

  const applyShortcut = (event) => {
    if (!settings.enabled || event.defaultPrevented || !event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    const digit = event.code?.startsWith("Digit") ? Number(event.code.replace("Digit", "")) : Number(event.key);
    if (!Number.isInteger(digit) || digit < 1 || digit > currentSuggestions.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    applyValue(currentSuggestions[digit - 1].text, { replaceToken: true });
  };

  const setExpanded = (nextExpanded) => {
    expanded = nextExpanded;
    root.classList.toggle("edge-touch-bar--expanded", expanded);
    snippetPanel.hidden = !expanded;
    expandButton.textContent = expanded ? "▼" : "▶";
    expandButton.setAttribute("aria-expanded", String(expanded));

    if (expanded) {
      renderSnippets();
    }
  };

  const updateDictionaryUi = () => {
    modeBadge.textContent = activeDict().label.toUpperCase();
    renderSuggestions();
    if (expanded) {
      renderSnippets();
    }
  };

  const createStyles = () => {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        top: 10px;
        left: 50%;
        z-index: 2147483647;
        width: min(980px, calc(100vw - 24px));
        transform: translateX(-50%);
        color: #f9fbff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }

      #${ROOT_ID}[hidden] {
        display: none !important;
      }

      #${ROOT_ID},
      #${ROOT_ID} * {
        box-sizing: border-box;
      }

      .edge-touch-bar {
        display: grid;
        gap: 8px;
        border: 1px solid rgb(255 255 255 / 16%);
        border-radius: 8px;
        padding: 8px;
        background: rgb(18 20 27 / 82%);
        box-shadow: 0 12px 36px rgb(0 0 0 / 24%);
        backdrop-filter: blur(18px) saturate(140%);
      }

      .edge-touch-bar__main {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 8px;
      }

      .edge-touch-bar__expand,
      .edge-touch-bar__suggestion,
      .edge-touch-bar__snippet {
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 6px;
        color: #f9fbff;
        background: rgb(255 255 255 / 8%);
        font: inherit;
        cursor: pointer;
      }

      .edge-touch-bar__expand {
        width: 38px;
        height: 34px;
        padding: 0;
      }

      .edge-touch-bar__expand:hover,
      .edge-touch-bar__suggestion:hover,
      .edge-touch-bar__snippet:hover {
        background: rgb(105 225 255 / 18%);
      }

      .edge-touch-bar__input {
        width: 100%;
        min-width: 0;
        height: 34px;
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 6px;
        padding: 0 12px;
        color: #f9fbff;
        background: rgb(255 255 255 / 10%);
        outline: none;
        font: 500 14px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .edge-touch-bar__input::placeholder {
        color: rgb(249 251 255 / 58%);
      }

      .edge-touch-bar__mode,
      .edge-touch-bar__hint {
        border-radius: 6px;
        padding: 8px 10px;
        white-space: nowrap;
        text-align: center;
        font-size: 11px;
        font-weight: 800;
      }

      .edge-touch-bar__mode {
        min-width: 72px;
        color: #102019;
        background: linear-gradient(135deg, #72e7ff, #8affb2);
      }

      .edge-touch-bar__hint {
        color: #d8dee9;
        background: rgb(255 255 255 / 8%);
      }

      .edge-touch-bar__hint[hidden] {
        display: none;
      }

      .edge-touch-bar__suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .edge-touch-bar__suggestions[hidden],
      .edge-touch-bar__snippets[hidden] {
        display: none;
      }

      .edge-touch-bar__suggestion {
        display: inline-grid;
        grid-template-columns: 18px minmax(0, auto);
        align-items: center;
        gap: 6px;
        max-width: 210px;
        padding: 5px 9px 5px 5px;
        overflow: hidden;
        font-size: 12px;
      }

      .edge-touch-bar__suggestion[data-source="recent"] {
        border-color: rgb(138 255 178 / 34%);
      }

      .edge-touch-bar__shortcut {
        display: inline-grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 4px;
        color: #102019;
        background: #8affb2;
        font-size: 11px;
        font-weight: 800;
      }

      .edge-touch-bar__suggestion-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .edge-touch-bar__snippets {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(142px, 1fr));
        gap: 7px;
        max-height: min(360px, calc(100vh - 92px));
        overflow: auto;
        padding-top: 2px;
      }

      .edge-touch-bar__snippet {
        min-height: 36px;
        padding: 8px 10px;
        overflow: hidden;
        text-align: left;
        text-overflow: ellipsis;
        white-space: pre;
        font-size: 12px;
        line-height: 1.3;
      }

      @media (max-width: 640px) {
        #${ROOT_ID} {
          top: 6px;
          width: calc(100vw - 12px);
        }

        .edge-touch-bar__main {
          grid-template-columns: 34px minmax(0, 1fr);
        }

        .edge-touch-bar__mode,
        .edge-touch-bar__hint {
          grid-column: span 1;
        }
      }
    `;
    document.documentElement.append(style);
  };

  const createRoot = () => {
    if (document.getElementById(ROOT_ID)) {
      root = document.getElementById(ROOT_ID);
      return;
    }

    createStyles();
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="edge-touch-bar" role="region" aria-label="Touch Bar">
        <div class="edge-touch-bar__main">
          <button class="edge-touch-bar__expand" type="button" aria-label="Toggle snippets" aria-expanded="false">▶</button>
          <input class="edge-touch-bar__input" type="text" placeholder="Type for predictions or click a snippet">
          <span class="edge-touch-bar__mode" aria-live="polite"></span>
          <span class="edge-touch-bar__hint" hidden>Alt+1 inserts first</span>
        </div>
        <div class="edge-touch-bar__suggestions" hidden></div>
        <div class="edge-touch-bar__snippets" hidden></div>
      </div>
    `;

    document.documentElement.append(root);

    input = root.querySelector(".edge-touch-bar__input");
    suggestions = root.querySelector(".edge-touch-bar__suggestions");
    snippetPanel = root.querySelector(".edge-touch-bar__snippets");
    expandButton = root.querySelector(".edge-touch-bar__expand");
    modeBadge = root.querySelector(".edge-touch-bar__mode");
    shortcutHint = root.querySelector(".edge-touch-bar__hint");

    input.addEventListener("input", () => {
      rememberTerms(extractHistoryTerms(input.value));
      renderSuggestions();
    });
    expandButton.addEventListener("click", () => setExpanded(!expanded));
    updateDictionaryUi();
  };

  const setEnabled = (enabled) => {
    settings.enabled = enabled;
    if (!root) {
      createRoot();
    }
    root.hidden = !enabled;
  };

  const init = async () => {
    await Promise.all([loadDictionaries(), loadRecentHistory()]);
    settings = {
      ...DEFAULT_SETTINGS,
      ...(await chrome.storage.sync.get(DEFAULT_SETTINGS))
    };

    createRoot();
    setEnabled(settings.enabled);
    updateDictionaryUi();
  };

  document.addEventListener("focusin", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
      input.value = "";
      renderSuggestions();
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
      input.value = getEditableText(event.target).trim().split(/\s+/).pop() || "";
      scheduleRememberFromElement(event.target);
      renderSuggestions();
    }
  }, true);

  document.addEventListener("keydown", applyShortcut, true);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes.enabled) {
      setEnabled(Boolean(changes.enabled.newValue));
    }

    if (changes.dictionary) {
      settings.dictionary = changes.dictionary.newValue;
      updateDictionaryUi();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SET_TOUCH_BAR_ENABLED") {
      setEnabled(Boolean(message.enabled));
      sendResponse({ enabled: settings.enabled });
      return true;
    }

    if (message?.type === "SET_TOUCH_BAR_DICTIONARY") {
      settings.dictionary = message.dictionary;
      updateDictionaryUi();
      sendResponse({ dictionary: settings.dictionary });
      return true;
    }

    if (message?.type === "TOGGLE_TOUCH_BAR") {
      setEnabled(!settings.enabled);
      chrome.storage.sync.set({ enabled: settings.enabled });
      sendResponse({ enabled: settings.enabled });
      return true;
    }

    if (message?.type === "GET_DICTIONARY_META") {
      sendResponse({ dictionaries: getMeta() });
      return true;
    }

    return false;
  });

  init();
})();
