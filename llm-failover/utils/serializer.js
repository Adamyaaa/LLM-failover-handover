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
    `\nThis is the end of the history. Please do not continue or reply to the conversation yet. Simply acknowledge that you have received and understood this context by saying something short, like: "I have received the conversation context and am ready to continue when you are." and wait for my next input.`
  );

  return lines.join("\n");
}

function truncateContext(context) {
  const messages = [...context.messages];
  if (messages.length <= 7) {
    return context;
  }
  
  const optimizedMessages = [
    messages[0],
    {
      role: "system",
      content: "[... Intermediate conversation turns omitted for token optimization ...]"
    },
    ...messages.slice(-6)
  ];
  
  return {
    ...context,
    messageCount: optimizedMessages.length,
    messages: optimizedMessages
  };
}

function buildSummarizedPrompt(context, summary) {
  const lines = [
    `I was having a conversation on ${context.sourcePlatform} and hit the message limit. Here is an AI-generated summary of the conversation context:\n`,
    summary,
    `\nThis is the end of the history. Please do not continue or reply to the conversation yet. Simply acknowledge that you have received and understood this context by saying something short, like: "I have received the conversation context and am ready to continue when you are." and wait for my next input.`
  ];
  return lines.join("\n");
}

async function summarizeWithAI(context, provider, apiKey) {
  const historyText = context.messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const systemInstructions = "You are a context preservation assistant. Write a concise summary of the conversation history. Focus on the main goal, current codebase state, coding changes made, and what the user wants to do next. Do not reply to the conversation itself, only summarize it so another LLM can pick it up.";

  if (provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemInstructions}\n\nHere is the conversation history:\n\n${historyText}`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const summaryText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summaryText) {
      throw new Error("No text response returned from Gemini API");
    }
    return summaryText.trim();
  } else {
    const url = "https://api.openai.com/v1/chat/completions";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: systemInstructions
          },
          {
            role: "user",
            content: historyText
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API returned status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const summaryText = data.choices?.[0]?.message?.content;
    if (!summaryText) {
      throw new Error("No response returned from OpenAI API");
    }
    return summaryText.trim();
  }
}

// Export for use in content scripts and background worker
if (typeof module !== "undefined") {
  module.exports = { buildContext, buildInjectionPrompt, truncateContext, buildSummarizedPrompt, summarizeWithAI };
}
