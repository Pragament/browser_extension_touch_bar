const DEFAULT_SETTINGS = {
  enabled: true,
  dictionary: "english"
};

const fallbackMeta = {
  english: { label: "English", words: 64, snippets: 18 },
  html: { label: "HTML", words: 82, snippets: 20 },
  python: { label: "Python", words: 91, snippets: 20 }
};

const enabledToggle = document.querySelector("#enabledToggle");
const dictionarySelect = document.querySelector("#dictionarySelect");
const statusText = document.querySelector("#statusText");
const wordCount = document.querySelector("#wordCount");
const snippetCount = document.querySelector("#snippetCount");

let dictionaryMeta = fallbackMeta;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function notifyActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Some internal Edge pages do not allow content scripts.
  }
}

function renderMeta(dictionary) {
  const meta = dictionaryMeta[dictionary] || dictionaryMeta.english;
  wordCount.textContent = String(meta.words);
  snippetCount.textContent = String(meta.snippets);
}

async function loadMeta() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_DICTIONARY_META" });
    if (response?.dictionaries) {
      dictionaryMeta = response.dictionaries;
    }
  } catch {
    dictionaryMeta = fallbackMeta;
  }
}

async function init() {
  await loadMeta();
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  enabledToggle.checked = settings.enabled;
  dictionarySelect.value = settings.dictionary;
  statusText.textContent = settings.enabled ? "Visible on supported pages" : "Hidden";
  renderMeta(settings.dictionary);
}

enabledToggle.addEventListener("change", async () => {
  const enabled = enabledToggle.checked;
  await chrome.storage.sync.set({ enabled });
  statusText.textContent = enabled ? "Visible on supported pages" : "Hidden";
  await notifyActiveTab({ type: "SET_TOUCH_BAR_ENABLED", enabled });
});

dictionarySelect.addEventListener("change", async () => {
  const dictionary = dictionarySelect.value;
  await chrome.storage.sync.set({ dictionary });
  renderMeta(dictionary);
  await notifyActiveTab({ type: "SET_TOUCH_BAR_DICTIONARY", dictionary });
});

init();
