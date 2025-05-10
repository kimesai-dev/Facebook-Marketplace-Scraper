const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const COOKIES_PATH = path.join(__dirname, 'fb-cookies.json');

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
  const page = await browser.newPage();

  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
  console.log('👉 Please log in to Facebook manually...');

  await page.waitForTimeout(60000); // gives you 60 seconds to login

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log('✅ Cookies saved to fb-cookies.json');

  await browser.close();
})();
