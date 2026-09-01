const DEFAULT_SETTINGS = {
  enabled: true,
  dictionary: "english"
};
const DICTIONARY_FILES = {
  english: "dictionaries/english.json",
  html: "dictionaries/html.json",
  python: "dictionaries/python.json"
};
const DICTIONARY_API_URLS = {
  english: "https://staticapis.pragament.com/dictionaries/english.json",
  html: "https://staticapis.pragament.com/dictionaries/html.json",
  python: "https://staticapis.pragament.com/dictionaries/python.json"
};
const API_CACHE_KEY = "apiDictionaryCache";

let dictionaryMetaCache = null;
let dictionaryCache = null;

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (typeof value !== "string") {
      return false;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeDictionary(key, dictionary) {
  const source = Array.isArray(dictionary) ? { words: dictionary } : dictionary || {};

  return {
    label: source.label || key[0].toUpperCase() + key.slice(1),
    words: Array.isArray(source.words) ? source.words : [],
    snippets: Array.isArray(source.snippets) ? source.snippets : []
  };
}

function mergeDictionaries(key, localDictionary, apiDictionary) {
  const local = normalizeDictionary(key, localDictionary);
  const api = normalizeDictionary(key, apiDictionary);

  return {
    label: local.label || api.label,
    words: uniqueValues([...local.words, ...api.words]),
    snippets: uniqueValues([...local.snippets, ...api.snippets])
  };
}

async function loadLocalDictionaries() {
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
}

async function fetchApiDictionaries() {
  const stored = await chrome.storage.local.get({ [API_CACHE_KEY]: {} });
  const cached = stored[API_CACHE_KEY] || {};
  const nextCache = { ...cached };

  await Promise.all(
    Object.entries(DICTIONARY_API_URLS).map(async ([key, url]) => {
      try {
        const cachedEntry = cached[key] || {};
        const headers = {};

        if (cachedEntry.etag) {
          headers["If-None-Match"] = cachedEntry.etag;
        }

        if (cachedEntry.lastModified) {
          headers["If-Modified-Since"] = cachedEntry.lastModified;
        }

        const response = await fetch(url, { cache: "no-cache", headers });
        if (response.status === 304 && cachedEntry.dictionary) {
          nextCache[key] = {
            ...cachedEntry,
            checkedAt: Date.now()
          };
          return;
        }

        if (!response.ok) {
          throw new Error(`Unable to fetch ${url}`);
        }

        nextCache[key] = {
          fetchedAt: Date.now(),
          checkedAt: Date.now(),
          etag: response.headers.get("ETag") || cachedEntry.etag || "",
          lastModified: response.headers.get("Last-Modified") || cachedEntry.lastModified || "",
          dictionary: normalizeDictionary(key, await response.json())
        };
      } catch {
        // Keep using the most recent cached API dictionary while offline.
      }
    })
  );

  await chrome.storage.local.set({ [API_CACHE_KEY]: nextCache });

  return Object.fromEntries(
    Object.keys(DICTIONARY_API_URLS).map((key) => [key, normalizeDictionary(key, nextCache[key]?.dictionary)])
  );
}

async function getCachedApiDictionaries() {
  const stored = await chrome.storage.local.get({ [API_CACHE_KEY]: {} });
  const cached = stored[API_CACHE_KEY] || {};

  return Object.fromEntries(
    Object.keys(DICTIONARY_API_URLS).map((key) => [key, normalizeDictionary(key, cached[key]?.dictionary)])
  );
}

async function getDictionaries() {
  if (dictionaryCache) {
    return dictionaryCache;
  }

  const [localDictionaries, apiDictionaries] = await Promise.all([
    loadLocalDictionaries(),
    getCachedApiDictionaries()
  ]);

  dictionaryCache = Object.fromEntries(
    Object.keys(DICTIONARY_FILES).map((key) => [
      key,
      mergeDictionaries(key, localDictionaries[key], apiDictionaries[key])
    ])
  );
  dictionaryMetaCache = null;

  // Fetch online updates asynchronously in the background to not block the message response.
  fetchApiDictionaries()
    .then((updatedApiDictionaries) => {
      dictionaryCache = Object.fromEntries(
        Object.keys(DICTIONARY_FILES).map((key) => [
          key,
          mergeDictionaries(key, localDictionaries[key], updatedApiDictionaries[key])
        ])
      );
      dictionaryMetaCache = null;
    })
    .catch(() => {
      // Keep serving the cache-only merge if the background refresh fails.
    });

  return dictionaryCache;
}

async function getDictionaryMeta() {
  if (dictionaryMetaCache) {
    return dictionaryMetaCache;
  }

  const dictionaries = await getDictionaries();
  dictionaryMetaCache = Object.fromEntries(
    Object.entries(dictionaries).map(([key, dictionary]) => [
      key,
      {
        label: dictionary.label,
        words: dictionary.words.length,
        snippets: dictionary.snippets.length
      }
    ])
  );
  return dictionaryMetaCache;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({
    enabled: existing.enabled,
    dictionary: existing.dictionary
  });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-touch-bar" || !tab?.id) {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_TOUCH_BAR" });
    if (typeof response?.enabled === "boolean") {
      await chrome.storage.sync.set({ enabled: response.enabled });
    }
  } catch {
    const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    await chrome.storage.sync.set({ enabled: !current.enabled });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_DICTIONARIES") {
    getDictionaries()
      .then((dictionaries) => sendResponse({ dictionaries }))
      .catch(() => sendResponse({ dictionaries: {} }));

    return true;
  }

  if (message?.type === "GET_DICTIONARY_META") {
    getDictionaryMeta()
      .then((dictionaries) => sendResponse({ dictionaries }))
      .catch(() => sendResponse({ dictionaries: {} }));

    return true;
  }

  return false;
});
