// popup/popup.js

const content = document.getElementById("main-content");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const settingAutoSubmit = document.getElementById("setting-autosubmit");

// ─── Settings Panel Management ────────────────────────────────────────────────

// Toggle Settings panel visibility
settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

// Load settings from storage
chrome.storage.local.get({ autoSubmit: true }, (data) => {
  settingAutoSubmit.checked = data.autoSubmit;
});

// Save settings on change
settingAutoSubmit.addEventListener("change", () => {
  chrome.storage.local.set({ autoSubmit: settingAutoSubmit.checked });
});

// ─── Initialize Popup State ──────────────────────────────────────────────────

// 1. Check if there's a pending auto-detected limit context
chrome.runtime.sendMessage({ type: "GET_PENDING_CONTEXT" }, (response) => {
  const ctx = response?.context;
  if (ctx) {
    renderSwitchPrompt(ctx);
  } else {
    // 2. No auto-detected limit: check if user is currently on Claude to allow manual switch
    checkActiveTab();
  }
});

function checkActiveTab() {
  chrome.tabs.query({ active: true }, (tabs) => {
    // Filter out extension pages to find the actual active web page
    const activeTab = tabs.find(tab => tab.url && !tab.url.startsWith("chrome-extension://"));
    
    if (activeTab) {
      handleTab(activeTab);
    } else {
      // Fallback for E2E testing where the popup is loaded as a tab
      chrome.tabs.query({ url: "*://*.claude.ai/*" }, (claudeTabs) => {
        const firstClaudeTab = claudeTabs[0];
        handleTab(firstClaudeTab);
      });
    }
  });

  function handleTab(tab) {
    if (tab && tab.url && tab.url.includes("claude.ai")) {
      renderManualPrompt(tab);
    } else {
      renderEmpty();
    }
  }
}

// ─── Render: Auto-Limit Switch Prompt ─────────────────────────────────────────

function renderSwitchPrompt(ctx) {
  const lastMsg = ctx.messages[ctx.messages.length - 1];
  const preview = lastMsg
    ? `"${lastMsg.content.slice(0, 120)}${lastMsg.content.length > 120 ? "…" : ""}"`
    : "No preview available.";

  content.innerHTML = `
    <div class="status-badge">⚠️ Rate Limit Detected</div>
    
    <div class="card">
      <div class="card-title">Captured Conversation</div>
      <div class="stat-number">
        ${ctx.messageCount}<span>messages saved</span>
      </div>
      <div class="preview-text">${escapeHtml(preview)}</div>
    </div>

    <div class="btn-group">
      <button class="btn btn-chatgpt" id="btn-chatgpt" data-target="chatgpt">
        <span>Continue on ChatGPT</span>
      </button>
      <button class="btn btn-gemini" id="btn-gemini" data-target="gemini">
        <span>Continue on Gemini</span>
      </button>
      <button class="btn btn-secondary" id="btn-dismiss">
        Dismiss
      </button>
    </div>
  `;

  // Wire switch actions
  document.getElementById("btn-chatgpt").addEventListener("click", () => triggerSwitch("chatgpt"));
  document.getElementById("btn-gemini").addEventListener("click", () => triggerSwitch("gemini"));
  
  document.getElementById("btn-dismiss").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "DISMISS_SWITCH" }, () => {
      window.close();
    });
  });
}

// ─── Render: Manual Failover Prompt ───────────────────────────────────────────

function renderManualPrompt(tab) {
  content.innerHTML = `
    <div class="status-badge" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; border-color: rgba(245, 158, 11, 0.2);">
      🟢 Monitoring Claude.ai
    </div>

    <div class="flow-display">
      <div class="flow-node">
        <div class="platform-logo claude">🎨</div>
        <span>Claude</span>
      </div>
      <div class="flow-arrow">→</div>
      <div class="flow-node">
        <div class="platform-logo target">❓</div>
        <span>Next LLM</span>
      </div>
    </div>

    <div class="info-box">
      <p>Transfer this conversation manually to another LLM at any time.</p>
    </div>

    <div class="btn-group">
      <button class="btn btn-chatgpt" id="btn-chatgpt">
        <span>Transfer to ChatGPT</span>
      </button>
      <button class="btn btn-gemini" id="btn-gemini">
        <span>Transfer to Gemini</span>
      </button>
    </div>
  `;

  document.getElementById("btn-chatgpt").addEventListener("click", () => runManualFailover(tab, "chatgpt"));
  document.getElementById("btn-gemini").addEventListener("click", () => runManualFailover(tab, "gemini"));
}

// ─── Render: Empty State ──────────────────────────────────────────────────────

function renderEmpty() {
  content.innerHTML = `
    <div class="status-badge" style="background: rgba(107, 114, 128, 0.1); color: var(--text-secondary); border-color: var(--border);">
      🟢 Monitoring
    </div>

    <div class="info-box" style="padding: 20px 0;">
      <div class="icon">⚡</div>
      <p>Start a conversation on <strong style="color: var(--text-primary);">Claude.ai</strong>.</p>
      <p style="font-size: 11px; margin-top: 6px; color: var(--text-muted);">
        LLM Failover will watch for rate limits, or you can open the popup on Claude to switch manually.
      </p>
    </div>
  `;
}

// ─── Execution Helpers ────────────────────────────────────────────────────────

function triggerSwitch(targetPlatform) {
  chrome.runtime.sendMessage({
    type: "CONFIRM_SWITCH",
    payload: { targetPlatform }
  }, () => {
    window.close();
  });
}

function runManualFailover(tab, targetPlatform) {
  // Show a loading/processing message on the button
  const btn = document.getElementById(targetPlatform === "chatgpt" ? "btn-chatgpt" : "btn-gemini");
  const originalText = targetPlatform === "chatgpt" ? "Transfer to ChatGPT" : "Transfer to Gemini";
  btn.innerHTML = `<span style="opacity: 0.7;">Extracting context...</span>`;
  btn.disabled = true;

  chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONVERSATION" }, async (response) => {
    // Check if the script failed to respond (e.g. extension loaded after page load, requiring refresh)
    if (chrome.runtime.lastError || !response) {
      console.error("[LLM Failover] Extension content script not responding.", chrome.runtime.lastError);
      btn.innerText = "Refresh Claude page & try again";
      btn.disabled = false;
      setTimeout(() => { btn.innerText = originalText; }, 5000);
      return;
    }

    if (response.success && response.messages && response.messages.length > 0) {
      // Structure the pending context
      const context = {
        sourcePlatform: "claude",
        extractedAt: new Date().toISOString(),
        messageCount: response.messages.length,
        messages: response.messages.map((m) => ({
          role: m.role,
          content: m.content.trim(),
        })),
        sourceTabId: tab.id,
        sourceTabUrl: tab.url,
      };

      // Persist directly into storage
      await chrome.storage.local.set({ pendingContext: context });

      // Trigger switch directly
      triggerSwitch(targetPlatform);
    } else {
      console.warn("[LLM Failover] No messages found to extract.");
      btn.innerText = "Conversation is empty";
      btn.disabled = false;
      setTimeout(() => { btn.innerText = originalText; }, 4000);
    }
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
