# ⚡ LLM Failover — Chrome Extension

> Hit Claude's message limit? Switch to ChatGPT or Gemini instantly — full conversation context preserved with a sleek, non-intrusive, in-page UI.

LLM Failover automatically detects when you hit a rate limit on Claude.ai and lets you transfer your conversation history to ChatGPT or Gemini with a single click.

---

## Features

- **Sleek In-Page Floating Toast:** A premium, dark-glassmorphism toast card injected directly into the Claude webpage via an isolated Shadow DOM when a limit is detected.
- **On-the-fly Switching:** Choose between continuing on **ChatGPT** or **Gemini** in real-time.
- **Tab Reuse:** Automatically queries and focuses existing ChatGPT/Gemini tabs instead of cluttering your browser with new windows.
- **Auto-Submit Toggle:** Choose to either submit the context prompt automatically or keep it focused for edit before sending.
- **Manual Failover:** Transfer your active Claude conversation at any time from the extension's toolbar popup.

---

## 🚀 Step-by-Step Setup Guide

Follow these simple steps to download and launch the extension on your laptop:

### Step 1: Clone or Download the Code
You can download the extension files to your machine using Git or direct ZIP download:
- **Using Git:** Run the following command in your terminal/command prompt:
  ```bash
  git clone https://github.com/Adamyaaa/LLM-failover-handover.git
  ```
- **Direct ZIP:** Click the green **Code** button at the top of this repository, select **Download ZIP**, and extract it on your computer.

### Step 2: Install the Extension in Chrome
1. Open Google Chrome and go to the extensions page by typing **`chrome://extensions/`** in the URL bar.
2. In the top-right corner, toggle the **Developer mode** switch to **ON**.
3. In the top-left corner, click the **Load unpacked** button.
4. Browse to and select the **`llm-failover`** folder inside the directory you cloned/extracted in Step 1.
5. The **LLM Failover** extension is now installed! You can click the puzzle piece icon in Chrome's toolbar and pin it for easy access.

---

## 🧪 How to Run E2E Integration Tests (Optional)

We have included a full Puppeteer-based integration test suite to verify the extension works perfectly without waiting to hit a real Claude limit.

1. Open a terminal or command prompt in the root of the project directory.
2. Install the test dependencies:
   ```bash
   npm install
   ```
3. Run the automated test suite:
   ```bash
   node test.js
   ```
4. A Puppeteer-controlled browser window will launch automatically and run three test cases:
   - **Test Case 1:** Simulates auto-limit detection on Claude and switches to ChatGPT with Auto-Submit.
   - **Test Case 2:** Simulates auto-limit detection on Claude and switches to Gemini with Auto-Submit.
   - **Test Case 3:** Manually triggers a conversation transfer from Claude to ChatGPT (skipping auto-submit).

---

## 📖 How to Use it Live

1. Go to [Claude.ai](https://claude.ai) and chat normally.
2. **Auto-Trigger:** Once Claude shows a rate limit message, the extension will capture the chat history, and a floating toast card will slide up in the bottom-right corner of the page. Select either **Continue on ChatGPT** or **Continue on Gemini**.
3. **Manual Trigger:** Click the **LLM Failover** icon in your browser toolbar while on any Claude chat tab, and click **Transfer to ChatGPT** or **Transfer to Gemini** to switch manually at any time!

---

## Project Structure

```
llm-failover-extension/
├── llm-failover/                  # The Chrome Extension package
│   ├── manifest.json              # MV3 config
│   ├── background/
│   │   └── service-worker.js      # Coordination service worker
│   ├── content-scripts/
│   │   ├── claude.js              # Claude rate limit detector & DOM scraper
│   │   ├── chatgpt-ready.js       # ChatGPT prompt injector
│   │   └── gemini-ready.js        # Gemini prompt injector
│   ├── popup/
│   │   ├── popup.html             # Toolbar manual action popup UI
│   │   └── popup.js               # Toolbar popup controller
│   └── icons/                     # Brand logo assets
├── test.js                        # E2E Puppeteer integration tests
└── package.json                   # Test dependencies
```
