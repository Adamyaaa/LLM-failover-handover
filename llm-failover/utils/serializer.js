// utils/serializer.js
// Normalizes scraped messages into a universal context object
// and builds the injection prompt for the target platform.

/**
 * Creates a universal context payload from raw scraped messages.
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} sourcePlatform - e.g. "claude"
 * @returns {Object} context
 */
function buildContext(messages, sourcePlatform) {
  return {
    sourcePlatform,
    extractedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map((m) => ({
      role: m.role,        // "user" | "assistant"
      content: m.content.trim(),
    })),
  };
}

/**
 * Turns the context into a priming prompt for the target LLM.
 * The prompt instructs the model to continue the conversation naturally.
 * @param {Object} context - from buildContext()
 * @returns {string} prompt string ready to inject
 */
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

// Export for use in content scripts and background worker
if (typeof module !== "undefined") {
  module.exports = { buildContext, buildInjectionPrompt };
}
