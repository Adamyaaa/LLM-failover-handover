# ⚡ LLM Failover — Chrome Extension

> Hit Claude's message limit? Switch to ChatGPT instantly — full conversation context preserved.

---

## How It Works

1. You're chatting on Claude and hit the rate limit
2. The extension detects the limit via DOM observation
3. A popup appears asking: **"Switch to ChatGPT?"**
4. You confirm → ChatGPT opens in a new tab with the full conversation pre-loaded
5. ChatGPT picks up exactly where Claude left off

---

## Project Structure

```
llm-failover/
├── manifest.json                  # MV3 extension config
├── background/
│   └── service-worker.js          # Coordinates the whole flow
├── content-scripts/
│   ├── claude.js                  # Detects limit + extracts conversation
│   └── chatgpt-ready.js           # Injects context into ChatGPT
├── popup/
│   ├── popup.html                 # The "Switch?" confirmation UI
│   └── popup.js                   # Popup logic
├── utils/
│   └── serializer.js              # Normalizes messages → injection prompt
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Setup (Load Unpacked)

1. Open Chrome → go to `chrome://extensions`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked**
4. Select this `llm-failover/` folder
5. The extension icon appears in your toolbar ✅

---

## How to Test

1. Go to `claude.ai` and start a conversation
2. To simulate a limit without actually hitting one, open the browser console on Claude and run:
   ```js
   chrome.runtime.sendMessage(
     // get extension ID from chrome://extensions
     "YOUR_EXTENSION_ID",
     {
       type: "CLAUDE_LIMIT_REACHED",
       payload: {
         sourcePlatform: "claude",
         messages: [
           { role: "user", content: "Explain recursion" },
           { role: "assistant", content: "Recursion is when a function calls itself..." },
           { role: "user", content: "Give me a code example in Python" }
         ]
       }
     }
   );
   ```
3. The popup should appear → click **Switch to ChatGPT**
4. ChatGPT opens with the full conversation context injected

---

## Key Technical Concepts

| Concept | Where |
|---|---|
| MutationObserver for DOM changes | `claude.js` |
| Chrome message passing | all files |
| Service Worker as coordinator | `service-worker.js` |
| Context serialization | `serializer.js` |
| ContentEditable injection | `chatgpt-ready.js` |
| chrome.storage for state | `service-worker.js` |

---

## Known Limitations

- **DOM selectors may break** if Claude or ChatGPT update their UI — check `SELECTORS` in `claude.js`
- ChatGPT injects context as a **single priming message** — the conversation history is reconstructed, not native
- Works best for text conversations (code blocks and formatting are preserved as plain text)

---

## Roadmap

- [ ] Add Gemini as a third failover target
- [ ] Let user set failover priority (Claude → GPT → Gemini)
- [ ] Store conversation history across sessions
- [ ] Show a non-intrusive badge notification instead of a popup window
- [ ] Firefox support (MV3 compatible)
