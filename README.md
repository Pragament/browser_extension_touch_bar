# Touch Bar for Microsoft Edge

A sleek, MacBook Pro‑style Touch Bar that sits at the top of every tab, bringing intelligent text predictions and code snippets right where you type.

![Extension popup](popup-screenshot.png) <!-- replace with actual screenshot if available -->

---

## ✨ Features

- **Persistent Touch Bar** – visible on every tab (toggle on/off via popup or keyboard shortcut).
- **Predictive typing** – suggests word completions as you type, powered by bundled dictionaries plus Pragament dictionary APIs.
- **Offline dictionary cache** – API dictionaries are cached locally after a successful fetch, so predictions keep working when you are offline.
- **Efficient API refreshes** – cached API dictionaries use `ETag` and `Last-Modified` validators when the server provides them.
- **Recent history first** – words and phrases you type are saved locally and prioritized ahead of built‑in dictionary matches.
- **Three built‑in dictionaries**:
  - **English** – common words and phrases.
  - **HTML** – tags, attributes, and common patterns.
  - **Python** – keywords, built‑ins, and common idioms.
- **Keyboard-first predictions** – predictions are numbered so you can insert them with `Alt+1`, `Alt+2`, etc. without using the mouse.
- **Expandable snippet bar** – click the arrow to reveal a grid of useful code snippets or phrases from the active dictionary. Click any snippet to insert it into the active input field.
- **Instant mode switching** – change the active dictionary on the fly from the popup.
- **Keyboard shortcut** – `Ctrl+Shift+T` (or `Cmd+Shift+T` on macOS) toggles the bar without opening the popup.

---

## 📦 Installation

Since this extension is not (yet) published to the Edge Add‑on store, you need to install it manually in **developer mode**.

1. **Download or clone** this repository to your computer.
2. Open Microsoft Edge and go to `edge://extensions/`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the folder that contains the extension’s `manifest.json`.
5. The Touch Bar icon will appear in the toolbar. Click it to open the popup and configure your settings.

> The extension is now active. You should see the Touch Bar at the top of every webpage (unless you toggle it off).

---

## 🎮 Usage

### The Touch Bar

The bar appears as a translucent strip at the top of the page. It contains:

- An **input field** – start typing and suggestions will appear below.
- A **suggestion list** – click any suggestion or press its shortcut, such as `Alt+1`, to insert it into the active input field.
- A **shortcut hint** – the bar shows `Alt+1 inserts first` when predictions are available.
- An **expand/collapse button** (▶/▼) – opens the snippet panel.

### Snippet Panel

When expanded, the panel shows a grid of snippets relevant to the current dictionary:

- **English** – common phrases and replies.
- **HTML** – frequently used tags and attributes.
- **Python** – common code patterns and functions.

Click any snippet to insert it into the input field.

### Recent History

The extension stores recently typed words and short phrases in `chrome.storage.local` on your device. Recent history suggestions are shown before dictionary suggestions when they match what you are typing.

Recent history is local to the browser profile and is not sent to a server by this extension.

### Dictionary Sources

Each active dictionary merges two sources:

- Bundled JSON files in `extension/dictionaries/`.
- Remote JSON APIs:
  - `https://staticapis.pragament.com/dictionaries/english.json`
  - `https://staticapis.pragament.com/dictionaries/html.json`
  - `https://staticapis.pragament.com/dictionaries/python.json`

The extension stores successful API responses in `chrome.storage.local`. If the API is unavailable, the extension falls back to the cached API dictionary and the bundled local JSON file. If no API cache exists yet, the bundled JSON still works by itself.

When a cached API dictionary includes an `ETag` or `Last-Modified` response header, the extension sends `If-None-Match` or `If-Modified-Since` on later refreshes. If the server returns `304 Not Modified`, the extension keeps using the cached dictionary without downloading the JSON body again.

### Popup Controls

Click the extension icon in the toolbar to open the popup, where you can:

- **Toggle the bar** on/off globally.
- **Switch dictionaries** – choose English, HTML, or Python.
- **View dictionary size** – the number of words currently loaded.

### Keyboard Shortcut

- `Ctrl+Shift+T` (Windows/Linux) or `Cmd+Shift+T` (macOS) – instantly show or hide the Touch Bar on the current page.
- `Alt+1` through `Alt+8` – insert the matching numbered prediction into the active input field.

---

## 🛠️ Development

### Project Structure

```
extension/
├── manifest.json          # Extension manifest (V3)
├── popup.html             # Popup UI
├── popup.js               # Popup logic
├── content.js             # Touch Bar injected into every page
├── background.js          # Background service worker (for shortcuts)
├── dictionaries/          # Dictionary JSON files
│   ├── english.json
│   ├── html.json
│   └── python.json
└── icons/                 # Icon assets (if any)
```

### Modifying Dictionaries

The prediction and snippet data are stored in separate JSON files:

```json
{
  "label": "English",
  "words": ["hello", "world"],
  "snippets": ["Thanks!", "Sounds good."]
}
```

To add, remove, or replace bundled words/snippets, edit the matching file in `extension/dictionaries/`. The changes will take effect after you reload the extension in `edge://extensions/` (click the reload icon on the extension card).

Remote API dictionary entries are merged with the bundled entries at runtime. Duplicate words and snippets are removed case-insensitively.

### API Cache Behavior

For users:

- The extension checks the remote dictionaries when the background service worker first needs dictionary data.
- If the server says a cached dictionary has not changed, the extension reuses the local cached copy.
- If you are offline or the API is temporarily unavailable, suggestions continue from the bundled dictionaries plus the last cached API dictionaries.
- Clearing extension storage in Edge removes recent typing history and cached API dictionaries.

For developers:

- API cache entries are stored under `apiDictionaryCache` in `chrome.storage.local`.
- Each cached API entry can contain `dictionary`, `etag`, `lastModified`, `fetchedAt`, and `checkedAt`.
- On a `200 OK` response, the extension stores the normalized dictionary body and response validators from `ETag` and `Last-Modified`.
- On a `304 Not Modified` response, the extension keeps the cached dictionary and updates `checkedAt`.
- On network or API failure, the extension leaves the previous cache untouched and merges whatever cached API dictionary exists with the bundled JSON.

### Changing the Snippet Display

Snippets are shown in the expanded panel. You can customize how they are rendered by modifying the `renderSnippets()` function in `content.js`.

### Styling

The Touch Bar’s appearance (colors, fonts, spacing) is controlled by the CSS injected via `content.js`. You can adjust the `style` tag or the inline styles to match your preferences.

### Building for Production

If you plan to publish the extension, you’ll need to:

- Add proper icons (16×16, 48×48, 128×128).
- Update the `manifest.json` with your own extension ID and permissions.
- Consider minifying the JavaScript for performance.

---

## ❓ Troubleshooting

| Issue | Solution |
|-------|----------|
| Touch Bar doesn’t appear | Make sure the toggle in the popup is ON. Also check that the extension is enabled in `edge://extensions/`. |
| Predictions don’t match the selected mode | Switch modes in the popup – the bar updates immediately. |
| Recent predictions are unexpected | They come from local typing history stored in `chrome.storage.local`; clear extension storage from Edge’s extension details page to reset them. |
| API dictionary is unavailable | The extension uses the last cached API dictionary and bundled local JSON. |
| Snippets panel is empty | Some dictionaries (like English) have fewer snippets; try switching to HTML or Python for more examples. |
| Keyboard shortcut doesn’t work | The shortcut might conflict with another extension or browser shortcut. You can change it in the `commands` section of `manifest.json`. |
| Changes to dictionaries don’t take effect | Reload the extension from `edge://extensions/` (click the reload icon). |

---

## 🙌 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on the repository where this extension is hosted.
