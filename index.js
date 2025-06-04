const express = require('express');
const { chromium } = require('playwright');

const app = express(); // <<<<<<<< THIS LINE IS CRUCIAL AND WAS LIKELY MISSING OR MISPLACED
const port = process.env.PORT || 3000;

app.use(express.json()); // for JSON webhook payloads

// Your app.post('/webhook', ...) route definition should come AFTER 'const app = express();'
app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', req.body);

  const { targetUrl } = req.body; // Assuming you're using the version that accepts a target URL

  if (!targetUrl) {
    console.error('No targetUrl provided in webhook payload');
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  let baseURL;
  let startURL;

  try {
    const parsedUrl = new URL(targetUrl);
    baseURL = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    startURL = targetUrl;
    console.log(`Starting crawl for baseURL: ${baseURL}, startURL: ${startURL}`);
  } catch (e) {
    console.error('Invalid targetUrl provided:', targetUrl, e);
    return res.status(400).json({ error: 'Invalid targetUrl format' });
  }

  // ... rest of your /webhook handler logic (launching Playwright, crawl function, etc.)
  // Ensure the rest of the code from the previous correct version is here

  const browser = await chromium.launch({ /* ... launch options ... */ });
  const context = await browser.newContext();
  const page = await context.newPage();
  const visited = new Set();
  const errors = [];
  let pagesCrawledCount = 0;

  // ... (page event listeners: 'console', 'requestfailed', 'pageerror') ...
  // page.on('console', msg => { ... });
  // page.on('requestfailed', request => { ... });
  // page.on('pageerror', pageError => { ... });


  async function crawl(urlToCrawl) {
    // ... (your crawl function logic) ...
    let currentUrl;
    try {
        currentUrl = new URL(urlToCrawl).toString();
        if (currentUrl.endsWith('/')) {
            currentUrl = currentUrl.slice(0, -1);
        }
    } catch (e) {
        console.error(`Invalid URL to crawl: ${urlToCrawl}`, e);
        errors.push(`Invalid URL encountered during crawl attempt: ${urlToCrawl}`);
        return;
    }

    const urlHostname = new URL(currentUrl).hostname;
    const baseHostname = new URL(baseURL).hostname;

    if (visited.has(currentUrl) || !(urlHostname === baseHostname || urlHostname.endsWith('.' + baseHostname))) {
      if (!visited.has(currentUrl)) {
        console.log(`Skipping off-site or already processed: ${currentUrl} (base: ${baseHostname})`);
      }
      return;
    }

    console.log(`Crawling: ${currentUrl}`);
    visited.add(currentUrl);
    pagesCrawledCount++;

    try {
      const response = await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
      if (!response) {
          errors.push(`No response received for ${currentUrl}`);
          return;
      }
      if (!response.ok()) {
        const errorText = `HTTP ${response.status()} at ${currentUrl}`;
        console.log(errorText);
        errors.push(errorText);
      }

      const links = await page.$$eval('a[href]', (anchors, pageBaseURLInternal) =>
        anchors.map(a => {
          try {
            // Ensure getAttribute returns a string before constructing URL
            const hrefAttr = a.getAttribute('href');
            if (typeof hrefAttr === 'string') {
                return new URL(hrefAttr, pageBaseURLInternal).href;
            }
            return null;
          } catch (e) {
            return null;
          }
        }).filter(href => href !== null)
      , page.url());

      console.log(`Found ${links.length} links on ${currentUrl}`);
      for (const link of links) {
        await crawl(link);
      }
    } catch (e) {
      const errorText = `Navigation or processing error at ${currentUrl}: ${e.message}`;
      console.error(errorText, e.stack);
      errors.push(errorText);
    }
  }

  // Event listeners for page errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const errorText = `Console error on ${page.url()}: ${msg.text()}`;
      console.log(errorText);
      errors.push(errorText);
    }
  });
  page.on('requestfailed', request => {
    const errorText = `Request failed on ${page.url()} for ${request.url()}: ${request.failure()?.errorText || 'Unknown failure reason'}`;
    console.log(errorText);
    errors.push(errorText);
  });
  page.on('pageerror', pageError => {
    const errorText = `Page error (uncaught exception) on ${page.url()}: ${pageError.message}`;
    console.log(errorText);
    errors.push(errorText);
  });


  try {
    await crawl(startURL);
  } catch (e) {
    console.error("Critical error during crawl process:", e);
    errors.push(`Critical crawl error: ${e.message}`);
  }

  console.log('Crawl finished.');
  console.log('Visited:', visited.size, 'pages');
  console.log('Pages Crawled (attempts):', pagesCrawledCount);
  console.log('Errors found:', errors.length);
  if (errors.length > 0) {
    console.log('--- ERROR DETAILS ---');
    errors.forEach(err => console.log(err));
    console.log('--- END ERROR DETAILS ---');
  }

  await browser.close();
  console.log('Browser closed.');

  res.json({
    target: startURL,
    visited: visited.size,
    crawled: pagesCrawledCount,
    errorCount: errors.length,
    errors
  });
});


app.get('/', (req, res) => {
  res.send('Webhook service is running.');
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
