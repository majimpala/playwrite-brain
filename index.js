const express = require('express');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json()); // To parse JSON request bodies
app.use(express.static(path.join(__dirname, 'public'))); // To serve the index.html file

// --- Bug Checking Logic ---
const isImageBroken = async (page, imgHandle) => {
    try {
        return await imgHandle.evaluate(img => !img.complete || typeof img.naturalWidth === 'undefined' || img.naturalWidth === 0);
    } catch (e) {
        console.error("Error checking image status:", e.message);
        return true;
    }
};

const isButtonUnresponsive = async (page, btnHandle) => {
    try {
        const originalUrl = page.url();
        let navigationOccurred = false;
        let networkRequestMade = false;
        
        page.once('framenavigated', () => navigationOccurred = true);
        page.once('request', () => networkRequestMade = true);

        await btnHandle.click({ timeout: 2000, force: true }).catch(() => {});
        await page.waitForTimeout(500);

        return !navigationOccurred && !networkRequestMade && page.url() === originalUrl;
    } catch (e) {
        console.error("Error clicking button:", e.message);
        return false;
    }
};


// --- Main API Endpoint for Scanning ---
app.post('/webhook', async (req, res) => {
    console.log('Webhook scan request received:', req.body);
    const { targetUrl, instructions } = req.body;

    if (!targetUrl) {
        return res.status(400).json({ error: 'targetUrl is required' });
    }
    
    const checkImages = instructions?.toLowerCase().includes('image');
    const checkButtons = instructions?.toLowerCase().includes('button');
    console.log(`Scan instructions: Check Images = ${checkImages}, Check Buttons = ${checkButtons}`);

    let browser;
    try {
        const parsedUrl = new URL(targetUrl);
        const baseURL = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
        
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
             userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
             ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();

        const visited = new Set();
        const report = {
            brokenImages: [],
            unresponsiveButtons: [],
            consoleErrors: [],
            pageErrors: []
        };

        page.on('console', msg => {
            if (msg.type() === 'error') {
                report.consoleErrors.push({ pageUrl: page.url(), detail: msg.text(), replicationSteps: `1. Go to ${page.url()}\n2. Open console.` });
            }
        });
        
        page.on('pageerror', err => {
             report.pageErrors.push({ pageUrl: page.url(), detail: err.message, replicationSteps: `1. Go to ${page.url()}` });
        });

        async function crawl(urlToCrawl) {
            let currentUrl;
            try {
                currentUrl = new URL(urlToCrawl, baseURL).toString();
            } catch (e) { return; }

            if (visited.has(currentUrl) || !currentUrl.startsWith(baseURL)) {
                return;
            }
            
            console.log(`Crawling: ${currentUrl}`);
            visited.add(currentUrl);

            try {
                await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });

                if (checkImages) {
                    for (const img of await page.$$('img')) {
                        if (await isImageBroken(page, img)) {
                            const src = await img.getAttribute('src') || 'N/A';
                            report.brokenImages.push({ pageUrl: currentUrl, detail: `Image src: ${src}`, replicationSteps: `1. Go to ${currentUrl}\n2. Find image with src "${src}".` });
                        }
                    }
                }

                if (checkButtons) {
                    for (const btn of await page.$$('button, a[role="button"]')) {
                        if (await btn.isVisible() && await isButtonUnresponsive(page, btn)) {
                            const text = await btn.textContent() || 'N/A';
                            report.unresponsiveButtons.push({ pageUrl: currentUrl, detail: `Button text: "${text.trim()}"`, replicationSteps: `1. Go to ${currentUrl}\n2. Click button with text "${text.trim()}".` });
                        }
                    }
                }

                const links = await page.$$eval('a[href]', anchors => anchors.map(a => a.href));
                for (const link of links) {
                    await crawl(link);
                }

            } catch (e) {
                report.pageErrors.push({ pageUrl: currentUrl, detail: `Failed to load page: ${e.message}`, replicationSteps: `1. Try to go to ${currentUrl}` });
            }
        }

        await crawl(targetUrl);

        console.log('Crawl finished.');
        res.json({ report });

    } catch (e) {
        console.error('Critical error in scan process:', e);
        res.status(500).json({ error: `Internal server error: ${e.message}` });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});


// --- Serve the Frontend ---
// This makes sure that your index.html file is sent when someone visits your site.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(port, () => {
    console.log(`Unified server running on http://localhost:${port}`);
});
