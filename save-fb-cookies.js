const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2' });
  console.log("❗ Please log in to Facebook manually in the popup browser.");

  await page.waitForTimeout(30000); // Wait 30 seconds for manual login

  const cookies = await page.cookies();
  fs.writeFileSync(path.join(__dirname, 'fb-cookies.json'), JSON.stringify(cookies, null, 2));
  console.log("✅ Facebook cookies saved.");
  await browser.close();
})();
