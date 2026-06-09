// background/service-worker.js
// Central coordinator: receives limit signal, stores context, opens ChatGPT tab.

// ─── Serializer (inlined since service workers can't import local files in MV3) ──

function buildContext(messages, sourcePlatform) {
  return {
    sourcePlatform,
    extractedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content.trim(),
    })),
  };
}

function buildInjectionPrompt(context) {
  const lines = [
    `I was having a conversation on ${context.sourcePlatform} and hit the message limit.`,
    `Please continue this conversation exactly where it left off. Here is the full history:\n`,
  ];

  for (const msg of context.messages) {
    const label = msg.role === "user" ? "User" : "Assistant";
    lines.push(`${label}: ${msg.content}\n`);
  }

  lines.push(
    `\nNow continue as the Assistant, picking up naturally from the last message above. Do not re-introduce yourself or summarize the history.`
  );

  return lines.join("\n");
}

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CLAUDE_LIMIT_REACHED") {
    handleLimitReached(msg.payload, sender.tab);
    sendResponse({ received: true });
  }

  if (msg.type === "GET_PENDING_CONTEXT") {
    // Popup is asking if there's a saved context ready to switch
    chrome.storage.local.get("pendingContext", (data) => {
      sendResponse({ context: data.pendingContext || null });
    });
    return true; // async response
  }

  if (msg.type === "CONFIRM_SWITCH") {
    // User confirmed the switch from the popup
    handleConfirmedSwitch(msg.payload?.targetPlatform);
    sendResponse({ ok: true });
  }

  if (msg.type === "DISMISS_SWITCH") {
    // User dismissed — clear stored context
    chrome.storage.local.remove("pendingContext");
    sendResponse({ ok: true });
  }

  return true;
});

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Called when Claude content script fires CLAUDE_LIMIT_REACHED.
 * Saves the context and opens the popup for user confirmation.
 */
async function handleLimitReached(payload, sourceTab) {
  const context = buildContext(payload.messages, payload.sourcePlatform);

  // Persist so popup can read it
  await chrome.storage.local.set({
    pendingContext: {
      ...context,
      sourceTabId: sourceTab?.id,
      sourceTabUrl: sourceTab?.url,
    },
  });

  console.log(
    `[LLM Failover] Context saved. ${context.messageCount} messages ready.`
  );

  // In-page floating toast injected via Claude content script handles the interaction.
  // We no longer open a standalone extension window here.
}

/**
 * Called when user clicks "Switch to ChatGPT" in the popup.
 * Opens ChatGPT and injects the context.
 */
async function handleConfirmedSwitch(targetPlatform) {
  const data = await chrome.storage.local.get("pendingContext");
  const context = data.pendingContext;

  if (!context) {
    console.error("[LLM Failover] No pending context found.");
    return;
  }

  // Load autoSubmit setting (default to true if not set)
  const { autoSubmit } = await chrome.storage.local.get({ autoSubmit: true });

  const prompt = buildInjectionPrompt(context);

  // Save the prompt so the content script can pick it up on load
  await chrome.storage.local.set({ pendingInjection: prompt });

  // Resolve target platform configuration
  const isGemini = targetPlatform === "gemini";
  const targetUrl = isGemini ? "https://gemini.google.com/" : "https://chatgpt.com/";
  const queryUrl = isGemini ? "*://gemini.google.com/*" : "*://chatgpt.com/*";
  const contentScript = isGemini ? "content-scripts/gemini-ready.js" : "content-scripts/chatgpt-ready.js";

  // Reuse existing tab if available, otherwise open a new one
  const existingTabs = await chrome.tabs.query({ url: queryUrl });
  let tab;
  let isNewTab = false;

  if (existingTabs.length > 0) {
    tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    tab = await chrome.tabs.create({ url: targetUrl });
    isNewTab = true;
  }

  // Helper function to inject script and send context
  async function performInjection() {
    setTimeout(async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [contentScript],
        });

        chrome.tabs.sendMessage(tab.id, {
          type: "INJECT_CONTEXT",
          payload: { prompt, autoSubmit },
        });

        // Clean up
        chrome.storage.local.remove(["pendingContext", "pendingInjection"]);
      } catch (err) {
        console.error(`[LLM Failover] Script injection failed for ${targetPlatform}:`, err);
      }
    }, isNewTab ? 2000 : 500);
  }

  // If new tab, wait for load. If existing tab, inject immediately
  if (isNewTab) {
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        performInjection();
      }
    });
  } else {
    if (tab.status === "complete") {
      performInjection();
    } else {
      chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          performInjection();
        }
      });
    }
  }
}
