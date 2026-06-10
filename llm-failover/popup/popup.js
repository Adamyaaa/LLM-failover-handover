// popup/popup.js

const content = document.getElementById("main-content");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const settingAutoSubmit = document.getElementById("setting-autosubmit");
const settingOptMode = document.getElementById("setting-optmode");
const aiSettingsContainer = document.getElementById("ai-settings-container");
const settingAiProvider = document.getElementById("setting-aiprovider");
const settingApiKey = document.getElementById("setting-apikey");

// ─── Settings Panel Management ────────────────────────────────────────────────

// Toggle Settings panel visibility
settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

// Load settings from storage
chrome.storage.local.get({
  autoSubmit: true,
  optMode: "full",
  aiProvider: "gemini",
  apiKey: ""
}, (data) => {
  settingAutoSubmit.checked = data.autoSubmit;
  settingOptMode.value = data.optMode;
  settingAiProvider.value = data.aiProvider;
  settingApiKey.value = data.apiKey;
  toggleAiContainer(data.optMode);
});

// Save settings on change
settingAutoSubmit.addEventListener("change", () => {
  chrome.storage.local.set({ autoSubmit: settingAutoSubmit.checked });
});

settingOptMode.addEventListener("change", () => {
  const mode = settingOptMode.value;
  chrome.storage.local.set({ optMode: mode });
  toggleAiContainer(mode);
});

settingAiProvider.addEventListener("change", () => {
  chrome.storage.local.set({ aiProvider: settingAiProvider.value });
});

settingApiKey.addEventListener("input", () => {
  chrome.storage.local.set({ apiKey: settingApiKey.value });
});

function toggleAiContainer(mode) {
  if (mode === "summarize") {
    aiSettingsContainer.style.display = "flex";
  } else {
    aiSettingsContainer.style.display = "none";
  }
}

// ─── Initialize Popup State ──────────────────────────────────────────────────

// 1. Check if there's a pending auto-detected limit context
chrome.runtime.sendMessage({ type: "GET_PENDING_CONTEXT" }, (response) => {
  const ctx = response?.context;
  if (ctx) {
    renderSwitchPrompt(ctx);
  } else {
    // 2. No auto-detected limit: check if user is currently on an LLM to allow manual switch
    checkActiveTab();
  }
});

function checkActiveTab() {
  chrome.tabs.query({ active: true }, (tabs) => {
    // Find active tab that is not an extension page
    const activeTab = tabs.find(tab => tab.url && !tab.url.startsWith("chrome-extension://"));
    
    if (activeTab) {
      handleTab(activeTab);
    } else {
      // Fallback for E2E testing where the popup is loaded as a tab
      chrome.tabs.query({}, (allTabs) => {
        const monitoredTabs = allTabs.filter(tab => 
          tab.url && (
            tab.url.includes("claude.ai") || 
            tab.url.includes("chatgpt.com") || 
            tab.url.includes("chat.openai.com") || 
            tab.url.includes("gemini.google.com")
          )
        );
        // Sort by lastAccessed descending to find the most recently viewed tab
        monitoredTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        
        if (monitoredTabs.length > 0) {
          handleTab(monitoredTabs[0]);
        } else {
          renderEmpty();
        }
      });
    }
  });

  function handleTab(tab) {
    if (!tab || !tab.url) {
      renderEmpty();
      return;
    }

    if (tab.url.includes("claude.ai")) {
      renderManualPrompt(tab, "claude", ["chatgpt", "gemini"]);
    } else if (tab.url.includes("chatgpt.com") || tab.url.includes("chat.openai.com")) {
      renderManualPrompt(tab, "chatgpt", ["claude", "gemini"]);
    } else if (tab.url.includes("gemini.google.com")) {
      renderManualPrompt(tab, "gemini", ["claude", "chatgpt"]);
    } else {
      renderEmpty();
    }
  }
}

// ─── Render Helpers ───────────────────────────────────────────────────────────

function getButtonHtml(target, actionType = "switch") {
  const isClaude = target === "claude";
  const isGemini = target === "gemini";
  
  const targetLabel = isClaude ? "Claude" : (isGemini ? "Gemini" : "ChatGPT");
  const actionText = actionType === "switch" ? `Continue on ${targetLabel}` : `Transfer to ${targetLabel}`;
  const customClass = `btn-${target}`;
  
  return `
    <button class="btn ${customClass}" id="btn-${target}" data-target="${target}">
      <span>${actionText}</span>
    </button>
  `;
}

// ─── Render: Auto-Limit Switch Prompt ─────────────────────────────────────────

function renderSwitchPrompt(ctx) {
  const lastMsg = ctx.messages[ctx.messages.length - 1];
  const preview = lastMsg
    ? `"${lastMsg.content.slice(0, 120)}${lastMsg.content.length > 120 ? "…" : ""}"`
    : "No preview available.";

  const source = ctx.sourcePlatform;
  let targets = [];
  if (source === "claude") {
    targets = ["chatgpt", "gemini"];
  } else if (source === "chatgpt") {
    targets = ["claude", "gemini"];
  } else if (source === "gemini") {
    targets = ["claude", "chatgpt"];
  }

  const sourceLabel = source === "claude" ? "Claude" : (source === "gemini" ? "Gemini" : "ChatGPT");

  let buttonsHtml = "";
  targets.forEach(target => {
    buttonsHtml += getButtonHtml(target, "switch");
  });

  buttonsHtml += `
    <button class="btn btn-secondary" id="btn-dismiss">
      Dismiss
    </button>
  `;

  content.innerHTML = `
    <div class="status-badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2);">
      ⚠️ ${sourceLabel} Limit Detected
    </div>
    
    <div class="card">
      <div class="card-title">Captured Conversation</div>
      <div class="stat-number">
        ${ctx.messageCount}<span>messages saved</span>
      </div>
      <div class="preview-text">${escapeHtml(preview)}</div>
    </div>

    <div class="btn-group">
      ${buttonsHtml}
    </div>
  `;

  // Wire switch actions
  targets.forEach(target => {
    document.getElementById(`btn-${target}`).addEventListener("click", () => triggerSwitch(target));
  });
  
  document.getElementById("btn-dismiss").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "DISMISS_SWITCH" }, () => {
      window.close();
    });
  });
}

// ─── Render: Manual Failover Prompt ───────────────────────────────────────────

function renderManualPrompt(tab, sourcePlatform, targets) {
  const sourceLabel = sourcePlatform === "claude" ? "Claude" : (sourcePlatform === "gemini" ? "Gemini" : "ChatGPT");
  const sourceLogo = sourcePlatform === "claude" ? "🎨" : (sourcePlatform === "gemini" ? "✨" : "💬");
  const logoClass = `platform-logo ${sourcePlatform}`;

  let buttonsHtml = "";
  targets.forEach(target => {
    buttonsHtml += getButtonHtml(target, "manual");
  });

  content.innerHTML = `
    <div class="status-badge" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; border-color: rgba(245, 158, 11, 0.2);">
      🟢 Monitoring ${sourceLabel}
    </div>

    <div class="flow-display">
      <div class="flow-node">
        <div class="${logoClass}">${sourceLogo}</div>
        <span>${sourceLabel}</span>
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
      ${buttonsHtml}
    </div>
  `;

  // Wire manual failover actions
  targets.forEach(target => {
    document.getElementById(`btn-${target}`).addEventListener("click", () => runManualFailover(tab, target));
  });
}

// ─── Render: Empty State ──────────────────────────────────────────────────────

function renderEmpty() {
  content.innerHTML = `
    <div class="status-badge" style="background: rgba(107, 114, 128, 0.1); color: var(--text-secondary); border-color: var(--border);">
      🟢 Monitoring
    </div>

    <div class="info-box" style="padding: 20px 0;">
      <div class="icon">⚡</div>
      <p>Start a conversation on <strong style="color: var(--text-primary);">Claude, ChatGPT, or Gemini</strong>.</p>
      <p style="font-size: 11px; margin-top: 6px; color: var(--text-muted);">
        LLM Failover will watch for rate limits on these platforms, or you can open this popup to switch manually at any time.
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
  const btn = document.getElementById(`btn-${targetPlatform}`);
  const targetLabel = targetPlatform === "claude" ? "Claude" : (targetPlatform === "gemini" ? "Gemini" : "ChatGPT");
  const originalText = `Transfer to ${targetLabel}`;
  
  btn.innerHTML = `<span style="opacity: 0.7;">Extracting context...</span>`;
  btn.disabled = true;

  chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONVERSATION" }, async (response) => {
    if (chrome.runtime.lastError || !response) {
      console.error("[LLM Failover] Extension content script not responding.", chrome.runtime.lastError);
      btn.innerText = "Refresh page & try again";
      btn.disabled = false;
      setTimeout(() => { btn.innerText = originalText; }, 5000);
      return;
    }

    if (response.success && response.messages && response.messages.length > 0) {
      // Determine the source platform from the active tab url
      let sourcePlatform = "claude";
      if (tab.url.includes("chatgpt.com") || tab.url.includes("chat.openai.com")) {
        sourcePlatform = "chatgpt";
      } else if (tab.url.includes("gemini.google.com")) {
        sourcePlatform = "gemini";
      }

      const context = {
        sourcePlatform,
        extractedAt: new Date().toISOString(),
        messageCount: response.messages.length,
        messages: response.messages.map((m) => ({
          role: m.role,
          content: m.content.trim(),
        })),
        sourceTabId: tab.id,
        sourceTabUrl: tab.url,
      };

      await chrome.storage.local.set({ pendingContext: context });
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
