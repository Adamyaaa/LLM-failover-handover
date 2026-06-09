// content-scripts/gemini-ready.js
// Runs on gemini.google.com — listens for an injection command from the background worker.

(function () {
  "use strict";

  if (window.__geminiReadyInitialized) {
    return;
  }
  window.__geminiReadyInitialized = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "INJECT_CONTEXT") {
      injectPrompt(msg.payload.prompt, msg.payload.autoSubmit);
      sendResponse({ success: true });
    }
    return true;
  });

  /**
   * Injects the priming prompt into Gemini's input field and optionally submits it.
   */
  function injectPrompt(promptText, autoSubmit) {
    // Gemini's main input is a contenteditable div inside a rich-textarea element
    const input =
      document.querySelector('rich-textarea div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"]');

    if (!input) {
      console.error("[LLM Failover] Gemini input not found. Page may still be loading.");
      // Retry after a short delay
      setTimeout(() => injectPrompt(promptText, autoSubmit), 1500);
      return;
    }

    // Focus the input
    input.focus();

    // Clear existing content
    input.innerHTML = "";

    // Insert text using execCommand (most reliable approach for contenteditable rich textareas)
    document.execCommand("insertText", false, promptText);

    // If execCommand didn't work (some browsers/environments), set directly
    if (!input.innerText.trim()) {
      input.innerText = promptText;
      // Dispatch an input event so framework picks up the change
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    console.log("[LLM Failover] Prompt injected into Gemini.");

    // Submit if autoSubmit is enabled (defaults to true if undefined)
    if (autoSubmit !== false) {
      setTimeout(() => {
        submitPrompt();
      }, 600);
    }
  }

  /**
   * Finds and clicks Gemini's send button.
   */
  function submitPrompt() {
    const sendBtn =
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('.send-button') ||
      document.querySelector('button[aria-label="Submit prompt"]');

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      console.log("[LLM Failover] Prompt submitted to Gemini.");
    } else {
      console.warn("[LLM Failover] Gemini send button not found or disabled.");
    }
  }
})();
