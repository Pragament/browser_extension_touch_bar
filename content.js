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
      root.style.left = `${position.left}px`;
      root.style.top = `${position.top}px`;
      root.style.transform = "none";
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

    const onPointerMove = (event) => {
      if (!isDragging || !root) {
        return;
      }
      event.preventDefault();

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

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

    const onPointerUp = () => {
      if (!isDragging) {
        return;
      }
      isDragging = false;
      dragHandle.classList.remove("edge-touch-bar__drag-handle--active");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
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

      dragHandle.classList.add("edge-touch-bar__drag-handle--active");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
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

    const onPointerMove = (event) => {
      if (!isResizing || !root) {
        return;
      }
      event.preventDefault();

      const deltaX = event.clientX - startX;
      let newWidth = initialWidth + deltaX;

      const maxWidth = Math.max(360, window.innerWidth - 24);
      newWidth = Math.max(360, Math.min(newWidth, maxWidth));

      size = { width: Math.round(newWidth) };
      applySize();
    };

    const onPointerUp = () => {
      if (!isResizing) {
        return;
      }
      isResizing = false;
      resizeHandle.classList.remove("edge-touch-bar__resize-handle--active");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
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

      resizeHandle.classList.add("edge-touch-bar__resize-handle--active");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
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

  document.addEventListener("focusin", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
      detectLanguageMode(event.target);
      input.value = "";
      renderSuggestions();
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (isEditable(event.target)) {
      lastEditable = event.target;
      detectLanguageMode(event.target);
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
