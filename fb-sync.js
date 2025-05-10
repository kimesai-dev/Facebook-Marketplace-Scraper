const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const SEARCH_URL = "https://www.facebook.com/marketplace/fortwayne";
const COOKIES_PATH = path.join(__dirname, 'fb-cookies.json');
const SEEN_LEADS_PATH = path.join(__dirname, 'seenLeads.json');

const motivationKeywords = [
  "must sell", "cash only", "as-is", "fixer", "investment", "motivated seller",
  "price reduced", "urgent", "needs work", "handyman", "foreclosure", "fast closing", "distressed"
];

let seenLeads = [];
if (fs.existsSync(SEEN_LEADS_PATH)) {
  seenLeads = JSON.parse(fs.readFileSync(SEEN_LEADS_PATH));
}

function scoreMotivation(text) {
  let score = 0;
  for (const keyword of motivationKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      score++;
    }
  }
  return score;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH));
    await page.setCookie(...cookies);
  }

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
  );

  await page.goto(SEARCH_URL, { waitUntil: 'networkidle2' });
  await page.waitForTimeout(8000);

  // Scroll to load more listings
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(2000);
  }

  const listings = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('a[href*="/marketplace/item/"]');
    cards.forEach(card => {
      const titleEl = card.querySelector('span');
      const title = titleEl?.innerText;
      const url = card.href;

      if (title && url) {
        results.push({ title, url });
      }
    });
    return results;
  });

  console.log(`🔍 Found ${listings.length} listings`);

  const freshLeads = listings
    .filter(lead => scoreMotivation(lead.title) > 0 && !seenLeads.includes(lead.url))
    .map(lead => ({
      ...lead,
      platform: 'Facebook',
      createdAt: new Date().toISOString()
    }));

  console.log(`🟡 Pushing ${freshLeads.length} new motivated leads to CRM`);
  console.log(freshLeads);

  if (freshLeads.length > 0) {
    try {
      await axios.post('http://localhost:3001/api/leads/import', {
        leads: freshLeads
      });
      console.log('✅ Successfully pushed new leads to CRM!');
    } catch (e) {
      console.error('❌ Error pushing leads:', e.message);
    }

    seenLeads.push(...freshLeads.map(lead => lead.url));
    fs.writeFileSync(SEEN_LEADS_PATH, JSON.stringify(seenLeads, null, 2));
  } else {
    console.log('⚠️ No new motivated leads to push');
  }

  await browser.close();
})();
