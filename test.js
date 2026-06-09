const puppeteer = require('puppeteer');
const path = require('path');

// ─── Shared Mock HTML templates ──────────────────────────────────────────────

const CLAUDE_SOURCE = `
  <!DOCTYPE html>
  <html>
  <body>
    <h2>Claude Chat (Mock)</h2>
    <div data-testid="conversation-turn">
      <div data-testid="human-message">Explain recursion</div>
      <div data-testid="assistant-message">Recursion is when a function calls itself...</div>
    </div>
    <div data-testid="conversation-turn">
      <div data-testid="human-message">Give me a Python example</div>
    </div>
  </body>
  </html>
`;

const CLAUDE_TARGET = `
  <!DOCTYPE html>
  <html>
  <body>
    <h2>Claude Chat (Mock Target)</h2>
    <div contenteditable="true" role="textbox" style="min-height: 50px; border:1px solid #ccc;"></div>
    <button aria-label="Send message">Send</button>
    <div id="status">Waiting...</div>
    <script>
      const input = document.querySelector('div[contenteditable="true"]');
      const btn = document.querySelector('button');
      btn.addEventListener('click', () => {
        document.getElementById('status').innerText = 'Submitted: ' + input.innerText;
      });
    </script>
  </body>
  </html>
`;

const CHATGPT_SOURCE = `
  <!DOCTYPE html>
  <html>
  <body>
    <h2>ChatGPT Chat (Mock)</h2>
    <article>
      <div data-testid="user-message">Explain recursion</div>
      <div data-message-author-role="assistant">Recursion is when a function calls itself...</div>
    </article>
    <article>
      <div data-testid="user-message">Give me a Python example</div>
    </article>
  </body>
  </html>
`;

const CHATGPT_TARGET = `
  <!DOCTYPE html>
  <html>
  <body>
    <h2>ChatGPT Chat (Mock Target)</h2>
    <div id="prompt-textarea" contenteditable="true" style="min-height: 50px; border:1px solid #ccc;"></div>
    <button data-testid="send-button">Send</button>
    <div id="status">Waiting...</div>
    <script>
      const input = document.getElementById('prompt-textarea');
      const btn = document.querySelector('[data-testid="send-button"]');
      btn.addEventListener('click', () => {
        document.getElementById('status').innerText = 'Submitted: ' + input.innerText;
      });
    </script>
  </body>
  </html>
`;

const GEMINI_SOURCE = `
  <!DOCTYPE html>
  <html>
  <body>
    <h2>Gemini Chat (Mock)</h2>
    <message-outer>
      <div class="query-text">Explain recursion</div>
      <div class="model-response">Recursion is when a function calls itself...</div>
    </message-outer>
    <message-outer>
      <div class="query-text">Give me a Python example</div>
    </message-outer>
  </body>
  </html>
`;

const GEMINI_TARGET = `
  <!DOCTYPE html>
  <html>
  <body>
    <h2>Gemini Chat (Mock Target)</h2>
    <rich-textarea><div contenteditable="true" style="min-height: 50px; border:1px solid #ccc;"></div></rich-textarea>
    <button aria-label="Send message">Send</button>
    <div id="status">Waiting...</div>
    <script>
      const input = document.querySelector('rich-textarea div');
      const btn = document.querySelector('button');
      btn.addEventListener('click', () => {
        document.getElementById('status').innerText = 'Submitted: ' + input.innerText;
      });
    </script>
  </body>
  </html>
`;

// ─── Automated Swap Test Case Helper ──────────────────────────────────────────

async function runAutoLimitTest({
  browser,
  worker,
  sourcePlatform,
  targetPlatform,
  sourceUrl,
  targetUrl,
  sourceBody,
  targetBody,
  toastButtonId
}) {
  console.log(`\n--- Running Auto-Limit: ${sourcePlatform} -> ${targetPlatform} ---`);
  
  // Set autoSubmit to true in storage
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ autoSubmit: true });
  });

  // Pre-create and mock target page
  const targetPage = await browser.newPage();
  await targetPage.setRequestInterception(true);
  targetPage.on('request', request => {
    if (request.url().includes(targetPlatform)) {
      request.respond({
        status: 200,
        contentType: 'text/html',
        body: targetBody
      });
    } else {
      request.respond({ status: 404 });
    }
  });
  await targetPage.goto(targetUrl);
  console.log(`${targetPlatform} mock page loaded.`);

  // Pre-create and mock source page
  const sourcePage = await browser.newPage();
  await sourcePage.setRequestInterception(true);
  sourcePage.on('request', request => {
    if (request.url().includes(sourcePlatform)) {
      request.respond({
        status: 200,
        contentType: 'text/html',
        body: sourceBody
      });
    } else {
      request.respond({ status: 404 });
    }
  });
  await sourcePage.goto(sourceUrl);
  console.log(`${sourcePlatform} mock page loaded.`);

  await sourcePage.evaluate(() => {
    const div = document.createElement('div');
    div.innerText = "You've reached your usage limit. Rate limit exceeded. Limit reached."; // triggers limit observer on all platforms
    document.body.appendChild(div);
  });

  // Wait for the Shadow DOM floating toast to appear
  console.log('Waiting for the in-page Shadow DOM toast to appear...');
  await sourcePage.waitForFunction((btnId) => {
    const host = document.getElementById('llm-failover-toast-root');
    if (!host) return false;
    const shadow = host.shadowRoot;
    return shadow && shadow.getElementById(btnId);
  }, { timeout: 12000 }, toastButtonId);

  // Click the target button on the toast
  console.log(`Clicking "${toastButtonId}" on the in-page toast...`);
  await sourcePage.evaluate((btnId) => {
    const host = document.getElementById('llm-failover-toast-root');
    const shadow = host.shadowRoot;
    const btn = shadow.getElementById(btnId);
    btn.click();
  }, toastButtonId);

  // Verify prompt injection and auto-submission on target page
  await targetPage.waitForFunction(
    () => {
      const el = document.getElementById('status');
      return el && el.innerText.startsWith('Submitted:');
    },
    { timeout: 15000 }
  );

  console.log(`Success: ${sourcePlatform} -> ${targetPlatform} prompt injected and auto-submitted!`);
  
  await targetPage.close();
  await sourcePage.close();
}

// ─── E2E Run Execution ────────────────────────────────────────────────────────

(async () => {
  console.log('Starting LLM Failover Extension E2E Integration Test Suite...');

  const extensionPath = path.join(__dirname, 'llm-failover');

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  try {
    // Locate the background service worker
    console.log('Finding extension background service worker...');
    const workerTarget = await browser.waitForTarget(
      target => target.type() === 'service_worker',
      { timeout: 10000 }
    );

    const worker = await workerTarget.worker();
    if (!worker) {
      throw new Error('Background service worker not found.');
    }
    console.log('Background service worker found!');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Log listeners
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        const page = await target.page();
        page.on('console', msg => {
          console.log(`[PAGE LOG - ${page.url().split('/').pop() || 'Popup'}] ${msg.text()}`);
        });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // RUN AUTOMATED RATE LIMIT SWAP PATHS (6 PERMUTATIONS)
    // ──────────────────────────────────────────────────────────────────────────

    // Path 1: Claude -> ChatGPT
    await runAutoLimitTest({
      browser,
      worker,
      sourcePlatform: 'claude',
      targetPlatform: 'chatgpt',
      sourceUrl: 'https://claude.ai/chat/auto-1',
      targetUrl: 'https://chatgpt.com/',
      sourceBody: CLAUDE_SOURCE,
      targetBody: CHATGPT_TARGET,
      toastButtonId: 'toast-btn-chatgpt'
    });

    // Path 2: Claude -> Gemini
    await runAutoLimitTest({
      browser,
      worker,
      sourcePlatform: 'claude',
      targetPlatform: 'gemini',
      sourceUrl: 'https://claude.ai/chat/auto-2',
      targetUrl: 'https://gemini.google.com/',
      sourceBody: CLAUDE_SOURCE,
      targetBody: GEMINI_TARGET,
      toastButtonId: 'toast-btn-gemini'
    });

    // Path 3: ChatGPT -> Claude
    await runAutoLimitTest({
      browser,
      worker,
      sourcePlatform: 'chatgpt',
      targetPlatform: 'claude',
      sourceUrl: 'https://chatgpt.com/chat/auto-3',
      targetUrl: 'https://claude.ai/new',
      sourceBody: CHATGPT_SOURCE,
      targetBody: CLAUDE_TARGET,
      toastButtonId: 'toast-btn-claude'
    });

    // Path 4: ChatGPT -> Gemini
    await runAutoLimitTest({
      browser,
      worker,
      sourcePlatform: 'chatgpt',
      targetPlatform: 'gemini',
      sourceUrl: 'https://chatgpt.com/chat/auto-4',
      targetUrl: 'https://gemini.google.com/',
      sourceBody: CHATGPT_SOURCE,
      targetBody: GEMINI_TARGET,
      toastButtonId: 'toast-btn-gemini'
    });

    // Path 5: Gemini -> Claude
    await runAutoLimitTest({
      browser,
      worker,
      sourcePlatform: 'gemini',
      targetPlatform: 'claude',
      sourceUrl: 'https://gemini.google.com/chat/auto-5',
      targetUrl: 'https://claude.ai/new',
      sourceBody: GEMINI_SOURCE,
      targetBody: CLAUDE_TARGET,
      toastButtonId: 'toast-btn-claude'
    });

    // Path 6: Gemini -> ChatGPT
    await runAutoLimitTest({
      browser,
      worker,
      sourcePlatform: 'gemini',
      targetPlatform: 'chatgpt',
      sourceUrl: 'https://gemini.google.com/chat/auto-6',
      targetUrl: 'https://chatgpt.com/',
      sourceBody: GEMINI_SOURCE,
      targetBody: CHATGPT_TARGET,
      toastButtonId: 'toast-btn-chatgpt'
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST CASE 7: Manual Failover -> Claude to ChatGPT (Auto-Submit = false)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Running Test Case 7: Manual Failover from Claude to ChatGPT (Auto-Submit = false) ---');

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ autoSubmit: false });
    });

    const gptPage7 = await browser.newPage();
    await gptPage7.setRequestInterception(true);
    gptPage7.on('request', request => {
      if (request.url().includes('chatgpt.com')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: CHATGPT_TARGET
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await gptPage7.goto('https://chatgpt.com/');
    console.log('ChatGPT mock page loaded.');

    const claudePage7 = await browser.newPage();
    await claudePage7.setRequestInterception(true);
    claudePage7.on('request', request => {
      if (request.url().includes('claude.ai')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: CLAUDE_SOURCE
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await claudePage7.goto('https://claude.ai/chat/manual-test');
    console.log('Claude mock page loaded.');

    await claudePage7.bringToFront();

    const extensionId = workerTarget.url().split('/')[2];
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;

    const popupPage7 = await browser.newPage();
    popupPage7.on('console', msg => console.log('[POPUP CONSOLE]', msg.text()));
    popupPage7.on('pageerror', err => console.error('[POPUP ERROR]', err.toString()));
    await popupPage7.goto(popupUrl);
    console.log('Popup page loaded manually.');

    await popupPage7.waitForSelector('#btn-chatgpt');
    
    const btnText = await popupPage7.$eval('#btn-chatgpt', el => el.innerText);
    console.log('Manual Failover button text:', btnText);
    if (!btnText.includes('Transfer to ChatGPT')) {
      throw new Error(`Expected manual failover button text, got: ${btnText}`);
    }

    console.log('Clicking "Transfer to ChatGPT" manual button...');
    await popupPage7.click('#btn-chatgpt');

    console.log('Waiting for script injection...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    const statusText = await gptPage7.$eval('#status', el => el.innerText);
    const inputText = await gptPage7.$eval('#prompt-textarea', el => el.innerText);

    console.log('Status on ChatGPT page (should be Waiting...):', statusText);
    console.log('Input Text on ChatGPT page:', inputText.substring(0, 100) + '...');

    if (statusText !== 'Waiting...') {
      throw new Error(`Expected status to remain "Waiting...", got: ${statusText}`);
    }

    if (!inputText.includes('Explain recursion') || !inputText.includes('Recursion is when a function calls itself...')) {
      throw new Error(`Expected input to contain conversation history, got: ${inputText}`);
    }

    console.log('Test Case 7: Manual failover context successfully injected and auto-submit correctly skipped!');

    console.log('\n✅ ALL 7 TEST CASES PASSED SUCCESSFULLY!');

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error);
    process.exitCode = 1;
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
})();
