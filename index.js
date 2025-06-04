// ... (other requires)

app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', req.body);
  console.log(`Starting crawl for baseURL: ${'https://academybugs.com'}, startPath: ${'/find-bugs/'}`); // Hardcoded for now

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', // Often needed in Docker/CI environments
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Helps with resource issues in Docker
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const visited = new Set();
  const baseURL = 'https://academybugs.com'; // Main domain to stay on
  const startURL = baseURL + '/find-bugs/'; // Initial URL
  const errors = [];
  let pagesCrawledCount = 0;

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const errorText = `Console error on ${page.url()}: ${msg.text()}`;
      console.log(errorText); // Log immediately
      errors.push(errorText);
    }
  });

  page.on('requestfailed', request => {
    const errorText = `Request failed on ${page.url()} for ${request.url()}: ${request.failure().errorText}`;
    console.log(errorText); // Log immediately
    errors.push(errorText);
  });

  page.on('pageerror', pageError => { // Catch unhandled exceptions in the page
    const errorText = `Page error (uncaught exception) on ${page.url()}: ${pageError.message}`;
    console.log(errorText); // Log immediately
    errors.push(errorText);
  });

  async function crawl(urlToCrawl) {
    // Normalize URL to avoid re-crawling due to trivial differences (e.g. trailing slash)
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


    // Check if URL belongs to the base domain and hasn't been visited
    // A more robust check for "on same site"
    const urlHostname = new URL(currentUrl).hostname;
    const baseHostname = new URL(baseURL).hostname;
    if (visited.has(currentUrl) || !(urlHostname === baseHostname || urlHostname.endsWith('.' + baseHostname))) {
      if (visited.has(currentUrl)) {
        // console.log(`Already visited: ${currentUrl}`);
      } else {
        console.log(`Skipping off-site or already processed: ${currentUrl}`);
      }
      return;
    }

    console.log(`Crawling: ${currentUrl}`);
    visited.add(currentUrl);
    pagesCrawledCount++;

    try {
      // Increased timeout, and try 'networkidle' for pages heavy on JS
      const response = await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
      if (!response) {
        errors.push(`No response received for ${currentUrl} (likely a navigation error caught below)`);
        return;
      }
      if (!response.ok()) {
        const errorText = `HTTP ${response.status()} at ${currentUrl}`;
        console.log(errorText);
        errors.push(errorText);
      }

      // Extract links
      const links = await page.$$eval('a[href]', (anchors, pageBaseURL) =>
        anchors.map(a => {
          try {
            return new URL(a.getAttribute('href'), pageBaseURL).href; // Resolve relative URLs
          } catch (e) {
            return null; // Invalid href
          }
        }).filter(href => href !== null)
      , page.url()); // Pass current page's URL as base for resolving relative links

      console.log(`Found ${links.length} links on ${currentUrl}`);

      for (const link of links) {
        // Small delay to be polite and avoid overwhelming the server or Playwright
        // await new Promise(resolve => setTimeout(resolve, 50));
        await crawl(link); // Recursive call
      }
    } catch (e) {
      const errorText = `Navigation or processing error at ${currentUrl}: ${e.message}`;
      console.error(errorText, e); // Log the full error object for more details
      errors.push(errorText);
    }
  }

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

  res.json({ visited: visited.size, crawled: pagesCrawledCount, errorCount: errors.length, errors });
});

// ... (app.get and app.listen)
