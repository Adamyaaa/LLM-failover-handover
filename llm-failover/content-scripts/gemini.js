// content-scripts/gemini.js
// Runs on gemini.google.com — scrapes chats, injects incoming context, detects limits, and shows toast.

(function () {
  "use strict";

  if (window.__geminiInitialized) {
    return;
  }
  window.__geminiInitialized = true;

  // ─── Selectors ────────────────────────────────────────────────────────────
  const SELECTORS = {
    // Turn container
    messageContainer: 'message-outer, chat-turn, .conversation-container, .message-content-wrapper',
    // User message
    humanMessage: '.query-text, .user-query, [data-testid="user-query"]',
    // Gemini response
    assistantMessage: '.model-response, .response-content, [data-testid="model-response"]',
    // Input textbox
    input: 'rich-textarea div[contenteditable="true"], div[contenteditable="true"], div[role="textbox"]',
    // Send button
    sendButton: 'button[aria-label="Send message"], .send-button, button[aria-label="Submit prompt"]',
    // Limit indicators
    limitBannerTexts: [
      "reached your limit",
      "rate limit exceeded",
      "quota exceeded",
      "try again later",
      "limit reached",
      "message limit"
    ]
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let limitDetected = false;
  let observer = null;

  // ─── Context Injection (Receiver Mode) ─────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "INJECT_CONTEXT") {
      injectPrompt(msg.payload.prompt, msg.payload.autoSubmit);
      sendResponse({ success: true });
    }
    if (msg.type === "EXTRACT_CONVERSATION") {
      const messages = extractConversation();
      sendResponse({ success: true, messages });
    }
    return true; // keep channel open
  });

  function injectPrompt(promptText, autoSubmit) {
    const input = document.querySelector(SELECTORS.input);
    if (!input) {
      console.error("[LLM Failover] Gemini input not found. Retrying...");
      setTimeout(() => injectPrompt(promptText, autoSubmit), 1500);
      return;
    }

    input.focus();
    input.innerHTML = "";
    document.execCommand("insertText", false, promptText);

    if (!input.innerText.trim()) {
      input.innerText = promptText;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    console.log("[LLM Failover] Prompt injected into Gemini.");

    if (autoSubmit !== false) {
      setTimeout(() => {
        submitPrompt();
      }, 600);
    }
  }

  function submitPrompt() {
    const sendBtn = document.querySelector(SELECTORS.sendButton);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      console.log("[LLM Failover] Prompt submitted to Gemini.");
    } else {
      console.warn("[LLM Failover] Gemini send button not found or disabled.");
    }
  }

  // ─── Limit Detection & Conversation Scraping ────────────────────────────────

  function isLimitReached() {
    const bodyText = document.body.innerText.toLowerCase();
    return SELECTORS.limitBannerTexts.some((phrase) =>
      bodyText.includes(phrase)
    );
  }

  function extractConversation() {
    const messages = [];
    const turns = document.querySelectorAll(SELECTORS.messageContainer);

    if (turns.length > 0) {
      turns.forEach((turn) => {
        const humanEl = turn.querySelector(SELECTORS.humanMessage);
        const assistantEl = turn.querySelector(SELECTORS.assistantMessage);

        if (humanEl) {
          messages.push({ role: "user", content: humanEl.innerText });
        }
        if (assistantEl) {
          messages.push({ role: "assistant", content: assistantEl.innerText });
        }
      });
    } else {
      // Fallback
      const allHuman = document.querySelectorAll(SELECTORS.humanMessage);
      const allAssistant = document.querySelectorAll(SELECTORS.assistantMessage);

      const allMessages = [
        ...Array.from(allHuman).map((el) => ({
          role: "user",
          content: el.innerText,
          node: el,
        })),
        ...Array.from(allAssistant).map((el) => ({
          role: "assistant",
          content: el.innerText,
          node: el,
        })),
      ];

      allMessages.sort((a, b) => {
        const pos = a.node.compareDocumentPosition(b.node);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      allMessages.forEach(({ role, content }) =>
        messages.push({ role, content })
      );
    }

    return messages.filter((m) => m.content && m.content.trim().length > 0);
  }

  function notifyLimitReached() {
    if (limitDetected) return;
    limitDetected = true;

    const messages = extractConversation();
    if (messages.length === 0) {
      console.warn("[LLM Failover] Gemini limit detected but conversation is empty.");
      return;
    }

    console.log(`[LLM Failover] Gemini limit detected. Extracted ${messages.length} messages.`);

    chrome.runtime.sendMessage({
      type: "LIMIT_REACHED",
      payload: {
        sourcePlatform: "gemini",
        messages,
        pageUrl: window.location.href,
      },
    });

    showToast(messages);
  }

  // ─── Floating Toast UI Injection ──────────────────────────────────────────

  function showToast(messages) {
    if (document.getElementById('llm-failover-toast-root')) {
      return;
    }

    const container = document.createElement('div');
    container.id = 'llm-failover-toast-root';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '2147483647';
    container.style.pointerEvents = 'none';

    const shadow = container.attachShadow({ mode: 'open' });

    const toastCard = document.createElement('div');
    toastCard.className = 'toast-card';
    toastCard.style.pointerEvents = 'auto';

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
      
      .toast-card {
        font-family: 'Outfit', sans-serif;
        width: 380px;
        background: rgba(20, 20, 22, 0.85);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        padding: 22px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        color: #f3f4f6;
        box-sizing: border-box;
        transform: translateY(120px) scale(0.95);
        opacity: 0;
        transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .toast-card.show {
        transform: translateY(0) scale(1);
        opacity: 1;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .title-container {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .icon-bolt {
        background: linear-gradient(135deg, #f59e0b, #ef4444);
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: white;
        box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
      }

      .title {
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.01em;
        margin: 0;
        color: #ffffff;
      }

      .close-btn {
        background: none;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s, color 0.2s;
        width: 28px;
        height: 28px;
      }

      .close-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      .body-text {
        font-size: 13.5px;
        color: #9ca3af;
        line-height: 1.5;
        margin: 0 0 16px 0;
      }

      .stats-badge {
        display: inline-flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 4px 12px;
        font-size: 12px;
        font-weight: 500;
        color: #e5e7eb;
        margin-bottom: 20px;
        gap: 6px;
      }

      .stats-dot {
        width: 6px;
        height: 6px;
        background: #10a37f;
        border-radius: 50%;
        box-shadow: 0 0 6px #10a37f;
      }

      .actions-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .btn {
        font-family: 'Outfit', sans-serif;
        font-size: 14px;
        font-weight: 600;
        padding: 11px 16px;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        border: none;
        outline: none;
        width: 100%;
      }

      .btn:active {
        transform: scale(0.98);
      }

      .btn-claude {
        background: rgba(217, 119, 6, 0.15);
        color: #d97706;
        border: 1px solid rgba(217, 119, 6, 0.3);
      }

      .btn-claude:hover {
        background: #d97706;
        color: #ffffff;
        box-shadow: 0 0 16px rgba(217, 119, 6, 0.4);
        border-color: #d97706;
      }

      .btn-chatgpt {
        background: rgba(16, 163, 127, 0.15);
        color: #10a37f;
        border: 1px solid rgba(16, 163, 127, 0.3);
      }

      .btn-chatgpt:hover {
        background: #10a37f;
        color: #ffffff;
        box-shadow: 0 0 16px rgba(16, 163, 127, 0.4);
        border-color: #10a37f;
      }

      .brand-icon {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }
    `;

    toastCard.innerHTML = `
      <div class="header">
        <div class="title-container">
          <div class="icon-bolt">⚡</div>
          <h3 class="title">Gemini Limit Reached</h3>
        </div>
        <button class="close-btn" id="toast-close-btn" aria-label="Close">&times;</button>
      </div>
      <p class="body-text">You've hit the rate limit on Gemini. Switch platform to continue your conversation seamlessly.</p>
      <div class="stats-badge">
        <span class="stats-dot"></span>
        <span id="toast-stats-text">${messages.length} messages captured</span>
      </div>
      <div class="actions-container">
        <button class="btn btn-claude" id="toast-btn-claude">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21L14.187 20.096L15 15L9.813 15.904Z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.187 8.096L15 3L9.813 3.904L9 9L14.187 8.096Z" />
          </svg>
          Continue on Claude
        </button>
        <button class="btn btn-chatgpt" id="toast-btn-chatgpt">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          Continue on ChatGPT
        </button>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(toastCard);
    document.body.appendChild(container);

    setTimeout(() => {
      toastCard.classList.add('show');
    }, 50);

    const closeBtn = shadow.getElementById('toast-close-btn');
    const claudeBtn = shadow.getElementById('toast-btn-claude');
    const chatgptBtn = shadow.getElementById('toast-btn-chatgpt');

    const dismissToast = () => {
      toastCard.classList.remove('show');
      setTimeout(() => {
        container.remove();
      }, 600);
    };

    closeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "DISMISS_SWITCH" });
      dismissToast();
    });

    claudeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: "CONFIRM_SWITCH",
        payload: { targetPlatform: "claude" }
      });
      dismissToast();
    });

    chatgptBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: "CONFIRM_SWITCH",
        payload: { targetPlatform: "chatgpt" }
      });
      dismissToast();
    });
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  function startObserver() {
    observer = new MutationObserver(() => {
      if (isLimitReached()) {
        notifyLimitReached();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function init() {
    if (isLimitReached()) {
      notifyLimitReached();
    } else {
      startObserver();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
