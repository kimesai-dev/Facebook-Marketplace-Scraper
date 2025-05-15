// fb-convo-bot.cjs
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const COOKIES_PATH = path.join(__dirname, 'fb-cookies.json');
const TEST_LISTING_URL = 'https://www.facebook.com/marketplace/item/1234567890'; // Replace with real listing URL
const MESSAGE = "Hey! I am interested in this house—can you give me some more details and an address please?";

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();

  // Load your Facebook cookies
  const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
  await page.setCookie(...cookies);

  console.log("▶️ Navigating to listing...");
  await page.goto(TEST_LISTING_URL, { waitUntil: 'networkidle2' });

  // Wait for Message button and click it
  try {
    console.log("💬 Looking for message button...");
    await page.waitForSelector('div[aria-label^="Message"]', { timeout: 10000 });
    await page.click('div[aria-label^="Message"]');
    await page.waitForTimeout(2000);

    // Type the message
    const messageBox = await page.waitForSelector('div[contenteditable="true"]', { timeout: 10000 });
    await messageBox.type(MESSAGE, { delay: 50 });

    // Press Enter to send
    await page.keyboard.press('Enter');
    console.log("✅ Message sent!");

  } catch (err) {
    console.error("❌ Failed to send message:", err.message);
  }

  await page.waitForTimeout(5000);
  await browser.close();
})();
