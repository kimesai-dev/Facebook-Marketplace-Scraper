// fb-convo-bot.cjs
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const COOKIES_PATH = path.join(__dirname, 'fb-cookies.json');
const MESSAGE = "Hey! I am interested in this house—can you give me some more details and an address please?";

const leads = [
  {
    link: "https://www.facebook.com/marketplace/item/475541468712563/?ref=browse_tab&referral_code=marketplace_top_picks&referral_story_type=top_picks"
  }
];

const LOG_PATH = path.join(__dirname, 'sent-messages.json');
let sentMessages = {};
if (fs.existsSync(LOG_PATH)) {
  sentMessages = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
}

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();

  // Load cookies
  const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
  await page.setCookie(...cookies);

  for (const lead of leads) {
    const url = lead.link || lead.url;
    if (!url || sentMessages[url]) continue;

    console.log(`💬 Messaging: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // 🔕 Try to close notifications popup
      try {
        await page.waitForSelector('[aria-label="Close"]', { timeout: 5000 });
        await page.click('[aria-label="Close"]');
        console.log("🔕 Closed notification popup.");
      } catch {}

      await page.waitForSelector('div[aria-label^="Message"]', { timeout: 10000 });
      await page.click('div[aria-label^="Message"]');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const messageBox = await page.waitForSelector('div[contenteditable="true"]', { timeout: 10000 });
      await messageBox.type(MESSAGE, { delay: 50 });
      await page.keyboard.press('Enter');

      console.log(`✅ Message sent to ${url}`);
      sentMessages[url] = { status: "sent", timestamp: new Date().toISOString() };

    } catch (err) {
      console.error(`❌ Failed to message ${url}: ${err.message}`);
      sentMessages[url] = { status: "failed", error: err.message, timestamp: new Date().toISOString() };
    }

    fs.writeFileSync(LOG_PATH, JSON.stringify(sentMessages, null, 2));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  await browser.close();
})();
