// content-scripts/claude.js
// Runs on claude.ai — detects rate limit, extracts conversation, notifies background.

(function () {
  "use strict";

  if (window.__claudeReadyInitialized) {
    return;
  }
  window.__claudeReadyInitialized = true;

  // ─── Selectors ────────────────────────────────────────────────────────────
  // These target Claude's DOM structure. May need updating if Claude changes its UI.
  const SELECTORS = {
    // Each conversation turn container
    messageContainer: '[data-testid="conversation-turn"], .conversation-turn',
    // Human message text
    humanMessage: '[data-testid="user-message"], [data-testid="human-message"], .font-user-message',
    // Claude's response text
    assistantMessage: '[data-testid="assistant-message"], [data-testid="ai-message"], .font-claude-message, .font-claude-response',
    // The send button (disabled when limited)
    sendButton: 'button[aria-label="Send message"]',
    // Rate limit / usage limit banner text patterns
    limitBannerTexts: [
      "you've reached your usage limit",
      "message limit reached",
      "usage limit",
      "you've hit the",
      "start a new conversation",
      "your limit",
    ],
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let limitDetected = false;
  let observer = null;

  // ─── Limit Detection ──────────────────────────────────────────────────────

  /**
   * Checks the entire visible DOM for any rate limit indicators.
   * Returns true if a limit signal is found.
   */
  function isLimitReached() {
    const bodyText = document.body.innerText.toLowerCase();
    return SELECTORS.limitBannerTexts.some((phrase) =>
      bodyText.includes(phrase)
    );
  }

  /**
   * Also watches for the send button becoming disabled as a secondary signal.
   */
  function isSendButtonDisabled() {
    const btn = document.querySelector(SELECTORS.sendButton);
    return btn && btn.disabled;
  }

  // ─── Conversation Extractor ───────────────────────────────────────────────

  /**
   * Walks the DOM and pulls all conversation turns into a normalized array.
   * Returns: Array<{ role: "user" | "assistant", content: string }>
   */
  function extractConversation() {
    const messages = [];

    // Strategy 1: use data-testid turn containers (most reliable)
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
      // Strategy 2: fallback — look for alternating message bubbles
      // Claude renders messages in divs with specific classes
      const allHuman = document.querySelectorAll(SELECTORS.humanMessage);
      const allAssistant = document.querySelectorAll(SELECTORS.assistantMessage);

      // Interleave by DOM order
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

      // Sort by DOM position
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

  // ─── Notify Background & Show Toast ───────────────────────────────────────

  function showToast(messages) {
    // Check if toast already exists
    if (document.getElementById('llm-failover-toast-root')) {
      return;
    }

    const container = document.createElement('div');
    container.id = 'llm-failover-toast-root';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '2147483647'; // max z-index
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

      .btn-gemini {
        background: rgba(138, 180, 248, 0.15);
        color: #8ab4f8;
        border: 1px solid rgba(138, 180, 248, 0.3);
      }

      .btn-gemini:hover {
        background: linear-gradient(135deg, #1a73e8, #8ab4f8);
        color: #ffffff;
        box-shadow: 0 0 16px rgba(138, 180, 248, 0.4);
        border-color: transparent;
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
          <h3 class="title">Claude Limit Reached</h3>
        </div>
        <button class="close-btn" id="toast-close-btn" aria-label="Close">&times;</button>
      </div>
      <p class="body-text">You've hit the rate limit on Claude. Switch platform to continue your conversation seamlessly.</p>
      <div class="stats-badge">
        <span class="stats-dot"></span>
        <span id="toast-stats-text">${messages.length} messages captured</span>
      </div>
      <div class="actions-container">
        <button class="btn btn-chatgpt" id="toast-btn-chatgpt">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          Continue on ChatGPT
        </button>
        <button class="btn btn-gemini" id="toast-btn-gemini">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2c0 5.523 4.477 10 10 10-5.523 0-10 4.477-10 10-0-5.523-4.477-10-10-10 5.523 0 10-4.477 10-10z" />
          </svg>
          Continue on Gemini
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
    const chatgptBtn = shadow.getElementById('toast-btn-chatgpt');
    const geminiBtn = shadow.getElementById('toast-btn-gemini');

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

    chatgptBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: "CONFIRM_SWITCH",
        payload: { targetPlatform: "chatgpt" }
      });
      dismissToast();
    });

    geminiBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: "CONFIRM_SWITCH",
        payload: { targetPlatform: "gemini" }
      });
      dismissToast();
    });
  }

  function notifyLimitReached() {
    if (limitDetected) return; // fire only once
    limitDetected = true;

    const messages = extractConversation();

    if (messages.length === 0) {
      console.warn("[LLM Failover] Limit detected but no messages found.");
      return;
    }

    console.log(
      `[LLM Failover] Rate limit detected. Extracted ${messages.length} messages.`
    );

    chrome.runtime.sendMessage({
      type: "CLAUDE_LIMIT_REACHED",
      payload: {
        sourcePlatform: "claude",
        messages,
        pageUrl: window.location.href,
      },
    });

    showToast(messages);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────
  // Watches the DOM for limit banners appearing dynamically

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

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    // Check immediately on load (in case page was refreshed after limit)
    if (isLimitReached()) {
      notifyLimitReached();
    } else {
      // Otherwise watch for it to appear
      startObserver();
    }
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ─── Listen for manual extraction request from popup ─────────────────────
  // User can also trigger extraction manually via the extension popup

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "EXTRACT_CONVERSATION") {
      const messages = extractConversation();
      sendResponse({ success: true, messages });
    }
    return true; // keep channel open for async response
  });
})();
