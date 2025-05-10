const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: './chrome-profile',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto('https://www.facebook.com/');
  await page.waitForTimeout(5000); // wait for Facebook to fully load

  console.log('👉 Log into Facebook manually in this window.');
  console.log('✅ Go to Marketplace, then close the browser — your session will be saved.');

  await page.waitForTimeout(60000); // give you 60 seconds to log in and go to Marketplace

  await browser.close();
})();
