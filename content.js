(() => {
  const ROOT_ID = "edge-touch-bar-root";
  const STYLE_ID = "edge-touch-bar-styles";
  const RECENT_HISTORY_KEY = "recentHistory";
  const MAX_RECENT_ITEMS = 240;
  const MAX_SUGGESTIONS = 8;
  const HISTORY_DEBOUNCE_MS = 500;
  const POSITION_KEY = "touchBarPosition";
  const SIZE_KEY = "touchBarSize";
  const DEFAULT_SETTINGS = {
    enabled: true,
    dictionary: "english"
  };
  const DICTIONARY_FILES = {
    english: "dictionaries/english.json",
    html: "dictionaries/html.json",
    python: "dictionaries/python.json"
  };

  const THEME_KEY = "touchBarTheme";
  const THEMES = {
    "dark-glass": "Dark Glass",
    "light-glass": "Light Glass",
    "cyberpunk": "Cyberpunk Neon",
    "slate": "Slate Minimal"
  };

  let dictionaries = {};
  let recentHistory = [];
  let currentSuggestions = [];
  let settings = { ...DEFAULT_SETTINGS };
  let theme = "dark-glass";
  let userOverrideDictionary = false;
  let minimized = false;
  let root;
  let shadowRoot;
  let dragHandle;
  let resizeHandle;
  let position = { top: 10, left: null };
  let size = { width: null };
  let input;
  let suggestions;
  let snippetPanel;
  let expandButton;
  let minimizeButton;
  let modeBadge;
  let modeContainer;
  let modeMenu;
  let shortcutHint;
  let lastEditable = null;
  let expanded = false;
  let historyTimer = null;

  const getCodeMirrorInstance = (element) => {
    if (!element) {
      return null;
    }
    const cmWrapper = element.closest?.(".CodeMirror") || document.querySelector(".CodeMirror");
    if (cmWrapper && cmWrapper.CodeMirror) {
      return cmWrapper.CodeMirror;
    }
    return null;
  };

  const isEditable = (element) => {
    if (!element || element === input) {
      return false;
    }

    if (element.closest?.(".CodeMirror") || element.closest?.(".monaco-editor") || element.closest?.(".ace_editor")) {
      return true;
    }

    const tagName = element.tagName?.toLowerCase();
    const blockedInputTypes = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
    return element.isContentEditable || tagName === "textarea" || (tagName === "input" && !blockedInputTypes.includes(element.type));
  };

  const detectLanguageMode = (targetElement) => {
    if (userOverrideDictionary) {
      return;
    }

    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const targetId = targetElement?.id?.toLowerCase() || "";
    const targetClass = typeof targetElement?.className === "string" ? targetElement.className.toLowerCase() : "";

    let detected = null;

    if (
      url.includes("html") ||
      title.includes("html") ||
      targetId.includes("html") ||
      targetClass.includes("html") ||
      targetId === "textareacode" ||
      document.querySelector(".CodeMirror")
    ) {
      detected = "html";
    } else if (
      url.includes("python") ||
      title.includes("python") ||
      targetId.includes("python") ||
      targetClass.includes("python") ||
      url.includes("colab") ||
      url.includes("jupyter")
    ) {
      detected = "python";
    }

    if (detected && detected !== settings.dictionary && dictionaries[detected]) {
      settings.dictionary = detected;
      updateDictionaryUi();
    }
  };

  const activeDict = () => dictionaries[settings.dictionary] || dictionaries.english || { label: "English", words: [], snippets: [] };

  // --- "Learn this" lookup: resolves a dictionary word or snippet to the
  // matching W3Schools reference page, so a student can click a suggestion
  // or snippet in the Touch Bar and jump straight to an explanation instead
  // of just inserting the text. Only offered for the HTML and Python
  // dictionaries. Anything not in the curated map below falls back to a
  // site-restricted search so the link always lands somewhere useful.
  const W3SCHOOLS_BASE = "https://www.w3schools.com";

  const HTML_TAG_NAMES = new Set([
    "a", "article", "aside", "button", "canvas", "div", "em", "fieldset", "footer",
    "form", "header", "img", "input", "label", "li", "main", "meta", "nav", "ol",
    "option", "p", "script", "section", "select", "span", "strong", "style",
    "table", "tbody", "td", "textarea", "th", "thead", "tr", "ul"
  ]);

  const HTML_ATTRIBUTES = new Set([
    "alt", "autocomplete", "class", "defer", "disabled", "for", "height", "href",
    "id", "loading", "method", "name", "placeholder", "rel", "required", "src",
    "target", "title", "type", "value", "width"
  ]);

  const PY_KEYWORDS = new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "break",
    "class", "continue", "def", "del", "elif", "else", "except", "finally", "for",
    "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
    "or", "pass", "raise", "return", "try", "while", "with", "yield"
  ]);

  const PY_BUILTIN_FUNCS = new Set([
    "abs", "all", "any", "dict", "enumerate", "filter", "format", "len", "list",
    "map", "open", "print", "range", "set", "sorted", "str", "sum", "tuple", "zip"
  ]);

  const PY_STRING_METHODS = new Set([
    "join", "split", "strip", "lower", "upper", "replace", "startswith", "endswith"
  ]);

  const PY_LIST_METHODS = new Set(["append"]);
  const PY_DICT_METHODS = new Set(["items", "keys", "get"]);
  const PY_EXCEPTIONS = new Set(["Exception", "FileNotFoundError", "TypeError", "ValueError"]);
  const PY_MODULE_PAGES = {
    json: "python/python_json.asp",
    datetime: "python/python_datetime.asp"
  };

  const w3SchoolsSearchUrl = (term) =>
    `https://www.google.com/search?q=${encodeURIComponent(`site:w3schools.com ${term}`)}`;

  const resolveW3SchoolsUrl = (dictionaryKey, rawTerm) => {
    const bare = (rawTerm || "").replace(/[<>]/g, "").trim();
    if (!bare) {
      return null;
    }
    const lower = bare.toLowerCase();

    if (dictionaryKey === "html") {
      if (lower === "doctype") {
        return `${W3SCHOOLS_BASE}/tags/tag_doctype.asp`;
      }
      if (/^h[1-6]$/.test(lower)) {
        return `${W3SCHOOLS_BASE}/tags/tag_hn.asp`;
      }
      if (HTML_TAG_NAMES.has(lower)) {
        return `${W3SCHOOLS_BASE}/tags/tag_${lower}.asp`;
      }
      if (HTML_ATTRIBUTES.has(lower)) {
        return `${W3SCHOOLS_BASE}/tags/att_${lower}.asp`;
      }
      return w3SchoolsSearchUrl(bare);
    }

    if (dictionaryKey === "python") {
      if (PY_KEYWORDS.has(bare)) {
        return `${W3SCHOOLS_BASE}/python/python_ref_keywords.asp`;
      }
      if (PY_BUILTIN_FUNCS.has(lower)) {
        return `${W3SCHOOLS_BASE}/python/ref_func_${lower}.asp`;
      }
      if (PY_STRING_METHODS.has(lower)) {
        return `${W3SCHOOLS_BASE}/python/ref_string_${lower}.asp`;
      }
      if (PY_LIST_METHODS.has(lower)) {
        return `${W3SCHOOLS_BASE}/python/ref_list_${lower}.asp`;
      }
      if (PY_DICT_METHODS.has(lower)) {
        return `${W3SCHOOLS_BASE}/python/ref_dict_${lower}.asp`;
      }
      if (PY_EXCEPTIONS.has(bare)) {
        return `${W3SCHOOLS_BASE}/python/python_ref_exceptions.asp`;
      }
      if (PY_MODULE_PAGES[lower]) {
        return `${W3SCHOOLS_BASE}/${PY_MODULE_PAGES[lower]}`;
      }
      return w3SchoolsSearchUrl(bare);
    }

    return null;
  };

  // For multi-line snippets, pick the first tag/keyword worth linking to
  // rather than the whole block.
  const extractPrimaryTerm = (dictionaryKey, text) => {
    if (dictionaryKey === "html") {
      const match = text.match(/<([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }
    if (dictionaryKey === "python") {
      const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
      const keywordOrBuiltin = tokens.find(
        (token) => PY_KEYWORDS.has(token) || PY_BUILTIN_FUNCS.has(token.toLowerCase())
      );
      return keywordOrBuiltin || tokens[0] || null;
    }
    return null;
  };

  const openW3SchoolsLookup = (dictionaryKey, term) => {
    const url = resolveW3SchoolsUrl(dictionaryKey, term);
    if (url) {
      window.open(url, "_blank", "noopener");
    }
  };

  const addLookupAffordance = (button, dictionaryKey, term, extraClass) => {
    if (dictionaryKey !== "html" && dictionaryKey !== "python") {
      return;
    }
    button.classList.add(extraClass);
    const lookup = document.createElement("span");
    lookup.className = "edge-touch-bar__lookup";
    lookup.textContent = "?";
    lookup.setAttribute("role", "button");
    lookup.setAttribute("tabindex", "0");
    lookup.title = `Look up "${term}" on W3Schools`;
    lookup.setAttribute("aria-label", `Look up ${term} on W3Schools`);
    const trigger = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openW3SchoolsLookup(dictionaryKey, term);
    };
    lookup.addEventListener("click", trigger);
    lookup.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        trigger(event);
      }
    });
    button.append(lookup);
  };

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

    const cm = getCodeMirrorInstance(element);
    if (cm) {
      const cursor = cm.getCursor();
      const line = cm.getLine(cursor.line);
      return line.slice(0, cursor.ch) || cm.getValue() || "";
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

    const cm = getCodeMirrorInstance(element);
    if (cm) {
      cm.focus();
      if (replaceToken) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const beforeCursor = line.slice(0, cursor.ch);
        const tokenStartMatch = beforeCursor.search(/\S+$/);
        const startCh = tokenStartMatch >= 0 ? tokenStartMatch : cursor.ch;
        cm.replaceRange(value, { line: cursor.line, ch: startCh }, cursor);
      } else {
        cm.replaceSelection(value);
      }
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
      addLookupAffordance(button, settings.dictionary, match.text, "edge-touch-bar__suggestion--lookup");
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
      const primaryTerm = extractPrimaryTerm(settings.dictionary, snippet);
      if (primaryTerm) {
        addLookupAffordance(button, settings.dictionary, primaryTerm, "edge-touch-bar__snippet--lookup");
      }
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

  const toggleModeMenu = (show) => {
    if (!modeMenu) {
      return;
    }

    const shouldShow = typeof show === "boolean" ? show : modeMenu.hidden;
    modeMenu.hidden = !shouldShow;
    modeBadge.setAttribute("aria-expanded", String(shouldShow));

    if (shouldShow) {
      renderModeMenu();
    }
  };

  const applyTheme = (nextTheme) => {
    theme = nextTheme;
    if (!shadowRoot) {
      return;
    }
    const container = shadowRoot.querySelector(".edge-touch-bar");
    if (container) {
      container.dataset.theme = theme;
    }
    chrome.storage.sync.set({ [THEME_KEY]: theme });
  };

  const loadSavedTheme = async () => {
    try {
      const stored = await chrome.storage.sync.get({ [THEME_KEY]: "dark-glass" });
      theme = stored[THEME_KEY] || "dark-glass";
    } catch {
      theme = "dark-glass";
    }
  };

  const setMinimized = (nextMinimized) => {
    minimized = nextMinimized;
    if (!shadowRoot) {
      return;
    }
    if (root) {
      root.classList.toggle("edge-touch-bar--minimized", minimized);
    }
    const container = shadowRoot.querySelector(".edge-touch-bar");
    if (container) {
      container.classList.toggle("edge-touch-bar--minimized", minimized);
    }
    if (minimizeButton) {
      minimizeButton.textContent = minimized ? "⤢" : "─";
      minimizeButton.title = minimized ? "Expand Touch Bar" : "Minimize to floating pill";
    }
  };

  const renderModeMenu = () => {
    if (!modeMenu) {
      return;
    }

    modeMenu.innerHTML = "";
    const meta = getMeta();

    const dictHeader = document.createElement("div");
    dictHeader.className = "edge-touch-bar__menu-header";
    dictHeader.textContent = "DICTIONARY";
    modeMenu.appendChild(dictHeader);

    Object.entries(dictionaries).forEach(([key, dict]) => {
      const isCurrent = key === settings.dictionary;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "edge-touch-bar__mode-item";
      item.dataset.active = isCurrent ? "true" : "false";

      const label = dict.label || key[0].toUpperCase() + key.slice(1);
      const wordCount = meta[key]?.words ?? dict.words?.length ?? 0;

      item.innerHTML = `
        <span>${isCurrent ? "✓ " : ""}${label}</span>
        <span class="edge-touch-bar__mode-meta">${wordCount} words</span>
      `;

      item.addEventListener("click", (event) => {
        event.stopPropagation();
        userOverrideDictionary = true;
        settings.dictionary = key;
        chrome.storage.sync.set({ dictionary: key });
        updateDictionaryUi();
        toggleModeMenu(false);
      });

      modeMenu.appendChild(item);
    });

    const themeHeader = document.createElement("div");
    themeHeader.className = "edge-touch-bar__menu-header";
    themeHeader.style.marginTop = "6px";
    themeHeader.textContent = "THEME";
    modeMenu.appendChild(themeHeader);

    Object.entries(THEMES).forEach(([tKey, tLabel]) => {
      const isCurrent = tKey === theme;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "edge-touch-bar__mode-item";
      item.dataset.active = isCurrent ? "true" : "false";

      item.innerHTML = `
        <span>${isCurrent ? "✓ " : ""}${tLabel}</span>
      `;

      item.addEventListener("click", (event) => {
        event.stopPropagation();
        applyTheme(tKey);
        toggleModeMenu(false);
      });

      modeMenu.appendChild(item);
    });
  };

  const updateDictionaryUi = () => {
    if (modeBadge) {
      modeBadge.innerHTML = `<span>${activeDict().label.toUpperCase()}</span><span class="edge-touch-bar__mode-arrow">▼</span>`;
    }
    renderSuggestions();
    if (expanded) {
      renderSnippets();
    }
  };

  const applyPosition = () => {
    if (!root) {
      return;
    }

    if (position && typeof position.left === "number" && typeof position.top === "number") {
      // Move via transform, not left/top: transform is composited on the GPU
      // and never triggers layout, so dragging stays smooth even with the
      // backdrop-filter blur on this element. Setting left/top here instead
      // is what caused the stutter/lag while dragging.
      root.style.left = "0";
      root.style.top = "0";
      root.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
    } else {
      root.style.left = "50%";
      root.style.top = "10px";
      root.style.transform = "translateX(-50%)";
    }
  };

  const loadSavedPosition = async () => {
    try {
      const stored = await chrome.storage.local.get({ [POSITION_KEY]: null });
      if (stored[POSITION_KEY]) {
        position = stored[POSITION_KEY];
      }
    } catch {
      // Use default position
    }
  };

  const savePosition = async () => {
    try {
      await chrome.storage.local.set({ [POSITION_KEY]: position });
    } catch {
      // Storage error
    }
  };

  const applySize = () => {
    if (!root) {
      return;
    }

    if (size && typeof size.width === "number") {
      root.style.setProperty("--touch-bar-width", `${size.width}px`);
    } else {
      root.style.removeProperty("--touch-bar-width");
    }
  };

  const loadSavedSize = async () => {
    try {
      const stored = await chrome.storage.local.get({ [SIZE_KEY]: null });
      if (stored[SIZE_KEY]) {
        size = stored[SIZE_KEY];
      }
    } catch {
      // Use default size
    }
  };

  const saveSize = async () => {
    try {
      await chrome.storage.local.set({ [SIZE_KEY]: size });
    } catch {
      // Storage error
    }
  };

  const initDragListeners = () => {
    if (!dragHandle) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let initialRect = null;
    let isDragging = false;
    let rafId = null;
    let pendingEvent = null;

    const flushMove = () => {
      rafId = null;
      if (!isDragging || !root || !pendingEvent) {
        return;
      }

      const deltaX = pendingEvent.clientX - startX;
      const deltaY = pendingEvent.clientY - startY;

      let newLeft = initialRect.left + deltaX;
      let newTop = initialRect.top + deltaY;

      const rootWidth = initialRect.width || 600;
      const rootHeight = initialRect.height || 50;

      const maxLeft = Math.max(0, window.innerWidth - rootWidth);
      const maxTop = Math.max(0, window.innerHeight - rootHeight);

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      position = { top: Math.round(newTop), left: Math.round(newLeft) };
      applyPosition();
    };

    const onPointerMove = (event) => {
      if (!isDragging) {
        return;
      }
      event.preventDefault();
      pendingEvent = event;
      // Coalesce every pointermove into a single update per animation
      // frame instead of doing a synchronous style + composite per event.
      if (rafId === null) {
        rafId = requestAnimationFrame(flushMove);
      }
    };

    const onPointerUp = (event) => {
      if (!isDragging) {
        return;
      }
      isDragging = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      dragHandle.classList.remove("edge-touch-bar__drag-handle--active");
      root.classList.remove("edge-touch-bar--dragging");
      document.documentElement.style.removeProperty("user-select");
      document.documentElement.style.removeProperty("cursor");
      if (dragHandle.hasPointerCapture?.(event.pointerId)) {
        dragHandle.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      savePosition();
    };

    dragHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      isDragging = true;
      startX = event.clientX;
      startY = event.clientY;
      initialRect = root.getBoundingClientRect();
      dragHandle.setPointerCapture?.(event.pointerId);

      dragHandle.classList.add("edge-touch-bar__drag-handle--active");
      // Drop the backdrop-filter blur and other transitions for the
      // duration of the drag: recomputing blur every frame is the other
      // big contributor to dragging feeling laggy.
      root.classList.add("edge-touch-bar--dragging");
      // Prevent the underlying page from selecting text while the pointer
      // sweeps across it during a fast drag.
      document.documentElement.style.userSelect = "none";
      document.documentElement.style.cursor = "grabbing";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    });

    dragHandle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      position = { top: 10, left: null };
      applyPosition();
      chrome.storage.local.remove(POSITION_KEY);
    });
  };

  const initResizeListeners = () => {
    if (!resizeHandle) {
      return;
    }

    let startX = 0;
    let initialWidth = 0;
    let isResizing = false;
    let rafId = null;
    let pendingEvent = null;

    const flushResize = () => {
      rafId = null;
      if (!isResizing || !root || !pendingEvent) {
        return;
      }

      const deltaX = pendingEvent.clientX - startX;
      let newWidth = initialWidth + deltaX;

      const maxWidth = Math.max(360, window.innerWidth - 24);
      newWidth = Math.max(360, Math.min(newWidth, maxWidth));

      size = { width: Math.round(newWidth) };
      applySize();
    };

    const onPointerMove = (event) => {
      if (!isResizing) {
        return;
      }
      event.preventDefault();
      pendingEvent = event;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushResize);
      }
    };

    const onPointerUp = (event) => {
      if (!isResizing) {
        return;
      }
      isResizing = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resizeHandle.classList.remove("edge-touch-bar__resize-handle--active");
      root.classList.remove("edge-touch-bar--dragging");
      if (resizeHandle.hasPointerCapture?.(event.pointerId)) {
        resizeHandle.releasePointerCapture(event.pointerId);
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      saveSize();
    };

    resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      isResizing = true;
      startX = event.clientX;
      initialWidth = root.getBoundingClientRect().width;
      resizeHandle.setPointerCapture?.(event.pointerId);

      resizeHandle.classList.add("edge-touch-bar__resize-handle--active");
      root.classList.add("edge-touch-bar--dragging");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    });

    resizeHandle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      size = { width: null };
      applySize();
      chrome.storage.local.remove(SIZE_KEY);
    });
  };

  const createStyles = () => {
    if (!shadowRoot || shadowRoot.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :host {
        position: fixed;
        top: 10px;
        left: 50%;
        z-index: 2147483647;
        width: var(--touch-bar-width, min(980px, calc(100vw - 24px)));
        max-width: calc(100vw - 24px);
        min-width: 360px;
        transform: translateX(-50%);
        color: #f9fbff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }

      :host([hidden]) {
        display: none !important;
      }

      :host(.edge-touch-bar--dragging) .edge-touch-bar {
        backdrop-filter: none;
        transition: none;
      }

      :host(.edge-touch-bar--dragging) {
        will-change: transform;
      }

      :host,
      :host * {
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
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
      }

      .edge-touch-bar__drag-handle,
      .edge-touch-bar__expand,
      .edge-touch-bar__mode-container,
      .edge-touch-bar__hint,
      .edge-touch-bar__resize-handle {
        flex-shrink: 0;
      }

      .edge-touch-bar__drag-handle,
      .edge-touch-bar__resize-handle {
        width: 24px;
        height: 34px;
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 6px;
        color: rgb(249 251 255 / 60%);
        background: rgb(255 255 255 / 6%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        user-select: none;
        touch-action: none;
        padding: 0;
        transition: background 0.15s ease, color 0.15s ease;
      }

      .edge-touch-bar__drag-handle {
        cursor: grab;
      }

      .edge-touch-bar__resize-handle {
        cursor: ew-resize;
      }

      .edge-touch-bar__drag-handle:hover,
      .edge-touch-bar__drag-handle--active,
      .edge-touch-bar__resize-handle:hover,
      .edge-touch-bar__resize-handle--active {
        background: rgb(105 225 255 / 20%);
        color: #72e7ff;
      }

      .edge-touch-bar__drag-handle--active {
        cursor: grabbing;
      }

      .edge-touch-bar__resize-handle--active {
        cursor: ew-resize;
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
        flex: 1 1 auto;
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

      .edge-touch-bar__mode-container {
        position: relative;
      }

      .edge-touch-bar__mode,
      .edge-touch-bar__hint {
        border-radius: 6px;
        padding: 6px 10px;
        white-space: nowrap;
        text-align: center;
        font-size: 11px;
        font-weight: 800;
      }

      .edge-touch-bar__mode {
        min-width: 76px;
        height: 34px;
        color: #102019;
        background: linear-gradient(135deg, #72e7ff, #8affb2);
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-family: inherit;
        transition: transform 0.15s ease, filter 0.15s ease;
        box-shadow: 0 2px 8px rgb(114 231 255 / 20%);
      }

      .edge-touch-bar__mode:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
      }

      .edge-touch-bar__mode-arrow {
        font-size: 8px;
        opacity: 0.8;
      }

      .edge-touch-bar__mode-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 180px;
        background: rgb(22 25 35 / 96%);
        border: 1px solid rgb(255 255 255 / 18%);
        border-radius: 8px;
        box-shadow: 0 12px 32px rgb(0 0 0 / 50%);
        padding: 6px;
        z-index: 1000;
        backdrop-filter: blur(16px);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .edge-touch-bar__mode-menu[hidden] {
        display: none !important;
      }

      .edge-touch-bar__mode-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: #f9fbff;
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease, color 0.15s ease;
      }

      .edge-touch-bar__mode-item:hover {
        background: rgb(114 231 255 / 18%);
        color: #ffffff;
      }

      .edge-touch-bar__mode-item[data-active="true"] {
        background: rgb(114 231 255 / 25%);
        font-weight: 700;
        color: #72e7ff;
      }

      .edge-touch-bar__mode-meta {
        font-size: 10px;
        opacity: 0.7;
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

      .edge-touch-bar__suggestion--lookup {
        grid-template-columns: 18px minmax(0, auto) 16px;
      }

      .edge-touch-bar__lookup {
        display: inline-grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgb(255 255 255 / 14%);
        color: #f5f7fb;
        font-size: 10px;
        font-weight: 800;
        line-height: 1;
        flex: 0 0 auto;
        cursor: pointer;
      }

      .edge-touch-bar__lookup:hover,
      .edge-touch-bar__lookup:focus-visible {
        background: #69e1ff;
        color: #102019;
        outline: none;
      }

      .edge-touch-bar__snippet--lookup {
        position: relative;
        padding-right: 26px;
      }

      .edge-touch-bar__snippet--lookup .edge-touch-bar__lookup {
        position: absolute;
        top: 6px;
        right: 6px;
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

      .edge-touch-bar__menu-header {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.5px;
        color: rgb(249 251 255 / 50%);
        padding: 4px 10px 2px 10px;
      }

      .edge-touch-bar__minimize {
        width: 24px;
        height: 34px;
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 6px;
        color: rgb(249 251 255 / 60%);
        background: rgb(255 255 255 / 6%);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        user-select: none;
        padding: 0;
        transition: background 0.15s ease, color 0.15s ease;
      }

      .edge-touch-bar__minimize:hover {
        background: rgb(105 225 255 / 20%);
        color: #72e7ff;
      }

      :host(.edge-touch-bar--minimized) {
        width: auto !important;
        min-width: 0 !important;
        max-width: fit-content !important;
      }

      .edge-touch-bar.edge-touch-bar--minimized {
        display: inline-flex !important;
        width: auto !important;
        max-width: fit-content !important;
        padding: 5px 8px;
        border-radius: 10px;
      }

      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__main {
        display: flex !important;
        width: auto !important;
        gap: 6px;
      }

      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__input,
      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__suggestions,
      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__snippets,
      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__hint,
      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__expand,
      .edge-touch-bar.edge-touch-bar--minimized .edge-touch-bar__resize-handle {
        display: none !important;
      }

      /* Light Glass Theme */
      .edge-touch-bar[data-theme="light-glass"] {
        background: rgb(242 245 250 / 92%);
        border-color: rgb(0 0 0 / 14%);
        color: #1e293b;
        box-shadow: 0 12px 36px rgb(0 0 0 / 14%);
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__input {
        background: rgb(255 255 255 / 85%);
        border-color: rgb(0 0 0 / 14%);
        color: #0f172a;
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__input::placeholder {
        color: rgb(15 23 42 / 55%);
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__expand,
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__drag-handle,
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__resize-handle,
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__minimize,
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__suggestion,
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__snippet {
        background: rgb(0 0 0 / 6%);
        border-color: rgb(0 0 0 / 12%);
        color: #1e293b;
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__lookup {
        background: rgb(0 0 0 / 10%);
        color: #1e293b;
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__mode-menu {
        background: rgb(255 255 255 / 96%);
        border-color: rgb(0 0 0 / 12%);
        color: #0f172a;
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__mode-item {
        color: #1e293b;
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__mode-item:hover {
        background: rgb(0 150 255 / 12%);
        color: #0077ff;
      }
      .edge-touch-bar[data-theme="light-glass"] .edge-touch-bar__menu-header {
        color: rgb(15 23 42 / 50%);
      }

      /* Cyberpunk Neon Theme */
      .edge-touch-bar[data-theme="cyberpunk"] {
        background: rgb(12 10 24 / 94%);
        border-color: #ff007f;
        box-shadow: 0 0 24px rgb(255 0 127 / 35%);
      }
      .edge-touch-bar[data-theme="cyberpunk"] .edge-touch-bar__mode {
        background: linear-gradient(135deg, #ff007f, #00f0ff);
        color: #ffffff;
      }
      .edge-touch-bar[data-theme="cyberpunk"] .edge-touch-bar__shortcut {
        background: #00f0ff;
        color: #000000;
      }

      /* Slate Minimal Theme */
      .edge-touch-bar[data-theme="slate"] {
        background: rgb(30 41 59 / 94%);
        border-color: rgb(255 255 255 / 12%);
        box-shadow: 0 12px 32px rgb(0 0 0 / 30%);
      }

      @media (max-width: 640px) {
        :host {
          top: 6px;
          width: calc(100vw - 12px);
        }

        .edge-touch-bar__main {
          gap: 6px;
        }

        .edge-touch-bar__hint {
          display: none !important;
        }
      }
    `;
    shadowRoot.append(style);
  };

  const createRoot = () => {
    if (document.getElementById(ROOT_ID)) {
      root = document.getElementById(ROOT_ID);
      shadowRoot = root.shadowRoot;
      return;
    }

    root = document.createElement("div");
    root.id = ROOT_ID;
    shadowRoot = root.attachShadow({ mode: "open" });

    createStyles();

    const container = document.createElement("div");
    container.className = "edge-touch-bar";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Touch Bar");
    container.innerHTML = `
      <div class="edge-touch-bar__main">
        <button class="edge-touch-bar__drag-handle" type="button" aria-label="Drag to move position" title="Drag to move (Double-click to reset position)">⋮⋮</button>
        <button class="edge-touch-bar__expand" type="button" aria-label="Toggle snippets" aria-expanded="false">▶</button>
        <input class="edge-touch-bar__input" type="text" placeholder="Type for predictions or click a snippet">
        <div class="edge-touch-bar__mode-container">
          <button class="edge-touch-bar__mode" type="button" aria-haspopup="true" aria-expanded="false"></button>
          <div class="edge-touch-bar__mode-menu" hidden role="menu"></div>
        </div>
        <span class="edge-touch-bar__hint" hidden>Alt+1 inserts first</span>
        <button class="edge-touch-bar__minimize" type="button" aria-label="Minimize Touch Bar" title="Minimize to floating pill">─</button>
        <button class="edge-touch-bar__resize-handle" type="button" aria-label="Resize width" title="Drag to resize width (Double-click to reset width)">↔</button>
      </div>
      <div class="edge-touch-bar__suggestions" hidden></div>
      <div class="edge-touch-bar__snippets" hidden></div>
    `;

    shadowRoot.append(container);
    document.documentElement.append(root);

    dragHandle = shadowRoot.querySelector(".edge-touch-bar__drag-handle");
    resizeHandle = shadowRoot.querySelector(".edge-touch-bar__resize-handle");
    input = shadowRoot.querySelector(".edge-touch-bar__input");
    suggestions = shadowRoot.querySelector(".edge-touch-bar__suggestions");
    snippetPanel = shadowRoot.querySelector(".edge-touch-bar__snippets");
    expandButton = shadowRoot.querySelector(".edge-touch-bar__expand");
    minimizeButton = shadowRoot.querySelector(".edge-touch-bar__minimize");
    modeContainer = shadowRoot.querySelector(".edge-touch-bar__mode-container");
    modeBadge = shadowRoot.querySelector(".edge-touch-bar__mode");
    modeMenu = shadowRoot.querySelector(".edge-touch-bar__mode-menu");
    shortcutHint = shadowRoot.querySelector(".edge-touch-bar__hint");

    input.addEventListener("input", () => {
      rememberTerms(extractHistoryTerms(input.value));
      renderSuggestions();
    });
    expandButton.addEventListener("click", () => setExpanded(!expanded));
    minimizeButton.addEventListener("click", () => setMinimized(!minimized));
    modeBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleModeMenu();
    });

    document.addEventListener("click", (event) => {
      if (modeMenu && !modeMenu.hidden && modeContainer && !event.composedPath().includes(modeContainer)) {
        toggleModeMenu(false);
      }
    }, true);

    initDragListeners();
    initResizeListeners();
    applyPosition();
    applySize();
    applyTheme(theme);
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
    await Promise.all([loadDictionaries(), loadRecentHistory(), loadSavedPosition(), loadSavedSize(), loadSavedTheme()]);
    settings = {
      ...DEFAULT_SETTINGS,
      ...(await chrome.storage.sync.get(DEFAULT_SETTINGS))
    };

    createRoot();
    setEnabled(settings.enabled);
    detectLanguageMode(document.activeElement);
    updateDictionaryUi();
  };

  let syncRafId = null;
  let pendingSyncTarget = null;

  const flushTouchBarSync = () => {
    syncRafId = null;
    if (!pendingSyncTarget || !input) {
      return;
    }
    input.value = getEditableText(pendingSyncTarget).trim().split(/\s+/).pop() || "";
    renderSuggestions();
  };

  // Coalesce every keystroke into a single DOM update per animation frame
  // instead of rebuilding the suggestion list synchronously on each one -
  // this is what caused typing to feel laggy on fast input.
  const scheduleTouchBarSync = (target) => {
    pendingSyncTarget = target;
    if (syncRafId === null) {
      syncRafId = requestAnimationFrame(flushTouchBarSync);
    }
  };

  document.addEventListener("focusin", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
      // Language mode is only worth (re-)detecting on focus change - it
      // does a document-wide querySelector, which is too costly to repeat
      // on every keystroke, and the field rarely changes dictionary mid-type.
      detectLanguageMode(event.target);
      input.value = "";
      renderSuggestions();
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
      scheduleRememberFromElement(event.target);
      scheduleTouchBarSync(event.target);
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
