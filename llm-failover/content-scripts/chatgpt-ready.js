// content-scripts/chatgpt-ready.js
// Runs on chatgpt.com — listens for an injection command from the background worker.

(function () {
  "use strict";

  if (window.__chatgptReadyInitialized) {
    return;
  }
  window.__chatgptReadyInitialized = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "INJECT_CONTEXT") {
      injectPrompt(msg.payload.prompt, msg.payload.autoSubmit);
      sendResponse({ success: true });
    }
    return true;
  });

  /**
   * Injects the priming prompt into ChatGPT's input field and submits it.
   * ChatGPT uses a contenteditable div as its input, not a <textarea>.
   */
  function injectPrompt(promptText, autoSubmit) {
    // ChatGPT's main input is a contenteditable div with id="prompt-textarea"
    const input = document.querySelector("#prompt-textarea");

    if (!input) {
      console.error("[LLM Failover] ChatGPT input not found. Page may still be loading.");
      // Retry after a short delay
      setTimeout(() => injectPrompt(promptText, autoSubmit), 1500);
      return;
    }

    // Focus the input
    input.focus();

    // Clear existing content
    input.innerHTML = "";

    // Insert text using execCommand (most reliable cross-browser approach for contenteditable)
    document.execCommand("insertText", false, promptText);

    // If execCommand didn't work (some browsers), set directly
    if (!input.innerText.trim()) {
      input.innerText = promptText;
      // Dispatch an input event so React picks up the change
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    console.log("[LLM Failover] Prompt injected into ChatGPT.");

    // Submit after a brief pause if autoSubmit is not disabled
    if (autoSubmit !== false) {
      setTimeout(() => {
        submitPrompt();
      }, 600);
    }
  }

  /**
   * Finds and clicks the send button.
   */
  function submitPrompt() {
    // ChatGPT send button
    const sendBtn =
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('button[aria-label="Send message"]');

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      console.log("[LLM Failover] Prompt submitted to ChatGPT.");
    } else {
      console.warn("[LLM Failover] Send button not found or disabled.");
    }
  }
})();
