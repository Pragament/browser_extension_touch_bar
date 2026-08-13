# Touch Bar for Microsoft Edge

A sleek, MacBook Pro‑style Touch Bar that sits at the top of every tab, bringing intelligent text predictions and code snippets right where you type.

![Extension popup](popup-screenshot.png) <!-- replace with actual screenshot if available -->

---

## ✨ Features

- **Persistent Touch Bar** – visible on every tab (toggle on/off via popup or keyboard shortcut).
- **Predictive typing** – suggests word completions as you type, powered by built‑in dictionaries.
- **Three built‑in dictionaries**:
  - **English** – common words and phrases.
  - **HTML** – tags, attributes, and common patterns.
  - **Python** – keywords, built‑ins, and common idioms.
- **Expandable snippet bar** – click the arrow to reveal a grid of useful code snippets or phrases from the active dictionary. Click any snippet to insert it into the input field.
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
- A **suggestion list** – click any suggestion to insert it into the input field.
- An **expand/collapse button** (▶/▼) – opens the snippet panel.

### Snippet Panel

When expanded, the panel shows a grid of snippets relevant to the current dictionary:

- **English** – common phrases and replies.
- **HTML** – frequently used tags and attributes.
- **Python** – common code patterns and functions.

Click any snippet to insert it into the input field.

### Popup Controls

Click the extension icon in the toolbar to open the popup, where you can:

- **Toggle the bar** on/off globally.
- **Switch dictionaries** – choose English, HTML, or Python.
- **View dictionary size** – the number of words currently loaded.

### Keyboard Shortcut

- `Ctrl+Shift+T` (Windows/Linux) or `Cmd+Shift+T` (macOS) – instantly show or hide the Touch Bar on the current page.

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
└── icons/                 # Icon assets (if any)
```

### Modifying Dictionaries

The prediction and snippet data are stored in `content.js` inside three arrays:

```javascript
const englishDict = ['hello', 'world', ...];
const htmlDict = ['<div>', '<p>', ...];
const pythonDict = ['def', 'class', ...];
```

To add, remove, or replace words/snippets, simply edit these arrays. The changes will take effect after you reload the extension in `edge://extensions/` (click the reload icon on the extension card).

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
| Snippets panel is empty | Some dictionaries (like English) have fewer snippets; try switching to HTML or Python for more examples. |
| Keyboard shortcut doesn’t work | The shortcut might conflict with another extension or browser shortcut. You can change it in the `commands` section of `manifest.json`. |
| Changes to dictionaries don’t take effect | Reload the extension from `edge://extensions/` (click the reload icon). |

---

## 🙌 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests on the repository where this extension is hosted.
