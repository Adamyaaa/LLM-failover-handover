const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  console.log('Starting LLM Failover Extension E2E Integration Test Suite...');

  const extensionPath = path.join(__dirname, 'llm-failover');

  // Launch browser with the extension loaded
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

    // Wait a brief moment for the extension APIs to fully bind in the service worker context
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Setup global log listeners
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        const page = await target.page();
        page.on('console', msg => {
          console.log(`[PAGE LOG - ${page.url().split('/').pop() || 'Popup'}] ${msg.text()}`);
        });
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST CASE 1: Auto-Limit -> ChatGPT (Auto-Submit = true)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Running Test Case 1: Auto-Limit to ChatGPT (Auto-Submit = true) ---');
    
    // Set autoSubmit to true in storage
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ autoSubmit: true });
    });

    // Pre-create and mock ChatGPT page
    const gptPage = await browser.newPage();
    await gptPage.setRequestInterception(true);
    gptPage.on('request', request => {
      const url = request.url();
      if (url.includes('chatgpt.com')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: `
            <!DOCTYPE html>
            <html>
            <body>
              <div id="prompt-textarea" contenteditable="true"></div>
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
          `
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await gptPage.goto('https://chatgpt.com/');
    console.log('ChatGPT mock page loaded.');

    // Pre-create and mock Claude page
    const claudePage1 = await browser.newPage();
    await claudePage1.setRequestInterception(true);
    claudePage1.on('request', request => {
      const url = request.url();
      if (url.includes('claude.ai')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: `
            <!DOCTYPE html>
            <html>
            <body>
              <h2>Claude Chat (Mock)</h2>
              <div data-testid="conversation-turn">
                <div data-testid="human-message">Explain recursion</div>
                <div data-testid="ai-message">Recursion is when a function calls itself...</div>
              </div>
              <div data-testid="conversation-turn">
                <div data-testid="human-message">Give me a Python example</div>
              </div>
            </body>
            </html>
          `
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await claudePage1.goto('https://claude.ai/chat/auto-test-1');
    console.log('Claude mock page loaded.');

    // Trigger rate limit on the Claude page by appending a rate limit phrase to the DOM
    console.log('Simulating rate limit by appending text to mock Claude page...');
    await claudePage1.evaluate(() => {
      const div = document.createElement('div');
      div.innerText = "You've reached your usage limit";
      document.body.appendChild(div);
    });

    // Wait for the Shadow DOM floating toast to appear
    console.log('Waiting for the in-page Shadow DOM toast to appear...');
    await claudePage1.waitForFunction(() => {
      const host = document.getElementById('llm-failover-toast-root');
      if (!host) return false;
      const shadow = host.shadowRoot;
      return shadow && shadow.getElementById('toast-btn-chatgpt');
    }, { timeout: 10000 });

    // Verify toast stats
    const toastStatsText = await claudePage1.evaluate(() => {
      const host = document.getElementById('llm-failover-toast-root');
      const shadow = host.shadowRoot;
      return shadow.getElementById('toast-stats-text').innerText;
    });
    console.log('Toast stats text:', toastStatsText);
    if (!toastStatsText.includes('3')) {
      throw new Error(`Expected toast message count of 3, got: ${toastStatsText}`);
    }

    // Click "Continue on ChatGPT" on the toast
    console.log('Clicking "Continue on ChatGPT" in the in-page toast...');
    await claudePage1.evaluate(() => {
      const host = document.getElementById('llm-failover-toast-root');
      const shadow = host.shadowRoot;
      const btn = shadow.getElementById('toast-btn-chatgpt');
      btn.click();
    });

    // Verify injection and auto-submission
    await gptPage.waitForFunction(
      () => {
        const el = document.getElementById('status');
        return el && el.innerText.startsWith('Submitted:');
      },
      { timeout: 10000 }
    );
    console.log('Test Case 1: ChatGPT prompt injected and auto-submitted successfully!');
    await gptPage.close();
    await claudePage1.close();

    // ──────────────────────────────────────────────────────────────────────────
    // TEST CASE 2: Auto-Limit -> Gemini (Auto-Submit = true)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Running Test Case 2: Auto-Limit to Gemini (Auto-Submit = true) ---');

    // Pre-create and mock Gemini page
    const geminiPage = await browser.newPage();
    await geminiPage.setRequestInterception(true);
    geminiPage.on('request', request => {
      const url = request.url();
      if (url.includes('gemini.google.com')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: `
            <!DOCTYPE html>
            <html>
            <body>
              <rich-textarea><div contenteditable="true"></div></rich-textarea>
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
          `
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await geminiPage.goto('https://gemini.google.com/');
    console.log('Gemini mock page loaded.');

    // Pre-create and mock Claude page
    const claudePage2 = await browser.newPage();
    await claudePage2.setRequestInterception(true);
    claudePage2.on('request', request => {
      const url = request.url();
      if (url.includes('claude.ai')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: `
            <!DOCTYPE html>
            <html>
            <body>
              <h2>Claude Chat (Mock)</h2>
              <div data-testid="conversation-turn">
                <div data-testid="human-message">What is JS?</div>
                <div data-testid="ai-message">JavaScript is a programming language...</div>
              </div>
              <div data-testid="conversation-turn">
                <div data-testid="human-message">Show me async code</div>
              </div>
            </body>
            </html>
          `
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await claudePage2.goto('https://claude.ai/chat/auto-test-2');
    console.log('Claude mock page loaded.');

    // Trigger rate limit on the Claude page by appending a rate limit phrase to the DOM
    console.log('Simulating rate limit by appending text to mock Claude page...');
    await claudePage2.evaluate(() => {
      const div = document.createElement('div');
      div.innerText = "You've reached your usage limit";
      document.body.appendChild(div);
    });

    // Wait for the Shadow DOM floating toast to appear
    console.log('Waiting for the in-page Shadow DOM toast to appear...');
    await claudePage2.waitForFunction(() => {
      const host = document.getElementById('llm-failover-toast-root');
      if (!host) return false;
      const shadow = host.shadowRoot;
      return shadow && shadow.getElementById('toast-btn-gemini');
    }, { timeout: 10000 });

    // Verify toast stats
    const toastStatsText2 = await claudePage2.evaluate(() => {
      const host = document.getElementById('llm-failover-toast-root');
      const shadow = host.shadowRoot;
      return shadow.getElementById('toast-stats-text').innerText;
    });
    console.log('Toast stats text:', toastStatsText2);
    if (!toastStatsText2.includes('3')) {
      throw new Error(`Expected toast message count of 3, got: ${toastStatsText2}`);
    }

    // Click "Continue on Gemini" on the toast
    console.log('Clicking "Continue on Gemini" in the in-page toast...');
    await claudePage2.evaluate(() => {
      const host = document.getElementById('llm-failover-toast-root');
      const shadow = host.shadowRoot;
      const btn = shadow.getElementById('toast-btn-gemini');
      btn.click();
    });

    // Verify injection and auto-submission
    await geminiPage.waitForFunction(
      () => {
        const el = document.getElementById('status');
        return el && el.innerText.startsWith('Submitted:');
      },
      { timeout: 10000 }
    );
    console.log('Test Case 2: Gemini prompt injected and auto-submitted successfully!');
    await geminiPage.close();
    await claudePage2.close();

    // ──────────────────────────────────────────────────────────────────────────
    // TEST CASE 3: Manual Failover -> ChatGPT (Auto-Submit = false)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Running Test Case 3: Manual Failover from Claude to ChatGPT (Auto-Submit = false) ---');

    // Set autoSubmit to false in storage
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ autoSubmit: false });
    });

    // Pre-create and mock ChatGPT page
    const gptPage3 = await browser.newPage();
    await gptPage3.setRequestInterception(true);
    gptPage3.on('request', request => {
      const url = request.url();
      if (url.includes('chatgpt.com')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: `
            <!DOCTYPE html>
            <html>
            <body>
              <div id="prompt-textarea" contenteditable="true"></div>
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
          `
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await gptPage3.goto('https://chatgpt.com/');
    console.log('ChatGPT mock page loaded.');

    // Pre-create and mock Claude page (to test manual extraction)
    const claudePage = await browser.newPage();
    await claudePage.setRequestInterception(true);
    claudePage.on('request', request => {
      const url = request.url();
      if (url.includes('claude.ai')) {
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: `
            <!DOCTYPE html>
            <html>
            <body>
              <h2>Claude Chat (Mock)</h2>
              <div data-testid="conversation-turn">
                <div data-testid="human-message">Manual Test User Prompt</div>
                <div data-testid="ai-message">Manual Test Assistant Response</div>
              </div>
            </body>
            </html>
          `
        });
      } else {
        request.respond({ status: 404 });
      }
    });
    await claudePage.goto('https://claude.ai/chat/manual-test');
    console.log('Claude mock page loaded.');

    // Bring the Claude tab to the front
    await claudePage.bringToFront();

    // Get the extension's popup URL
    const extensionId = workerTarget.url().split('/')[2];
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;

    // Open the popup page in a new Puppeteer page directly (since we are on a Claude tab)
    const popupPage3 = await browser.newPage();
    await popupPage3.goto(popupUrl);
    console.log('Popup page loaded manually.');

    // Wait for the manual failover button to be visible
    await popupPage3.waitForSelector('#btn-chatgpt');
    
    // Verify it contains the text "Transfer to ChatGPT"
    const btnText = await popupPage3.$eval('#btn-chatgpt', el => el.innerText);
    console.log('Manual Failover button text:', btnText);
    if (!btnText.includes('Transfer to ChatGPT')) {
      throw new Error(`Expected manual failover button text, got: ${btnText}`);
    }

    // Click "Transfer to ChatGPT"
    console.log('Clicking "Transfer to ChatGPT" manual button...');
    await popupPage3.click('#btn-chatgpt');

    // Wait 4 seconds to let the injection happen
    console.log('Waiting for script injection...');
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Verify prompt was injected but NOT auto-submitted
    const statusText = await gptPage3.$eval('#status', el => el.innerText);
    const inputText = await gptPage3.$eval('#prompt-textarea', el => el.innerText);

    console.log('Status on ChatGPT page (should be Waiting...):', statusText);
    console.log('Input Text on ChatGPT page:', inputText.substring(0, 100) + '...');

    if (statusText !== 'Waiting...') {
      throw new Error(`Expected status to remain "Waiting...", got: ${statusText}`);
    }

    if (!inputText.includes('Manual Test User Prompt') || !inputText.includes('Manual Test Assistant Response')) {
      throw new Error(`Expected input to contain conversation history, got: ${inputText}`);
    }

    console.log('Test Case 3: Manual failover context successfully injected and auto-submit correctly skipped!');

    console.log('\n✅ ALL TEST CASES PASSED SUCCESSFULLY!');

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error);
    process.exitCode = 1;
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
})();
