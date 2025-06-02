const express = require('express');
const { chromium } = require('playwright');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // for JSON webhook payloads

app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', req.body);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const visited = new Set();
  const baseURL = 'https://academybugs.com';
  const startPath = '/find-bugs/';
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`Console error: ${msg.text()}`);
    }
  });

  page.on('requestfailed', request => {
    errors.push(`Request failed: ${request.url()} - ${request.failure().errorText}`);
  });

  async function crawl(url) {
    if (visited.has(url) || !url.startsWith(baseURL)) return;
    visited.add(url);

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!response.ok()) {
        errors.push(`HTTP ${response.status()} at ${url}`);
      }

      const links = await page.$$eval('a[href]', as =>
        as.map(a => a.href).filter(href => href.startsWith('http'))
      );

      for (const link of links) {
        await crawl(link);
      }
    } catch (e) {
      errors.push(`Navigation error at ${url}: ${e.message}`);
    }
  }

  await crawl(baseURL + startPath);

  console.log('Visited:', visited.size, 'pages');
  console.log('Errors:', errors.length);
  console.log(errors);

  await browser.close();

  // Respond to webhook sender
  res.json({ visited: visited.size, errorCount: errors.length, errors });
});

app.get('/', (req, res) => {
  res.send('Webhook service is running.');
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
