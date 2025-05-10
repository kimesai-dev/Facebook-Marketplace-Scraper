const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SEARCH_URL = "https://www.facebook.com/marketplace/fortwayne/search/?query=house for sale by owner";
const COOKIES_PATH = path.join(__dirname, 'fb-cookies.json');

const motivationKeywords = [
  "must sell", "cash only", "as-is", "fixer", "investment", "motivated seller",
  "price reduced", "urgent", "needs work", "handyman", "foreclosure", "fast closing", "distressed"
];

function scoreMotivation(text) {
  let score = 0;
  for (const keyword of motivationKeywords) {
    if (text.toLowerCase().includes(keyword)) {
      score += 1;
    }
  }
  return score;
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
  await page.setCookie(...cookies);

  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");

  console.log("🔑 Logged in with cookies. Navigating to Marketplace...");
  await page.goto(SEARCH_URL, { waitUntil: 'networkidle2' });

  await new Promise(r => setTimeout(r, 8000));

  const listings = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a"));
    return anchors
      .filter(a => a.href.includes("/marketplace/item/"))
      .map(a => ({
        title: a.innerText || "Untitled",
        url: a.href
      }));
  });

  console.log(`✅ Found ${listings.length} listings`);

  const results = [];

  for (const listing of listings) {
    try {
      const detailPage = await browser.newPage();
      await detailPage.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
      await detailPage.setCookie(...cookies);
      await detailPage.goto(listing.url, { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 5000));

      const detail = await detailPage.evaluate(() => {
        const description = document.body.innerText || "";
        const priceMatch = description.match(/\$\d{3,}/);
        const price = priceMatch ? parseInt(priceMatch[0].replace("$", "").replace(",", "")) : null;
        return { description, price };
      });

      const score = scoreMotivation(listing.title + " " + detail.description);

      results.push({
        title: listing.title,
        url: listing.url,
        description: detail.description,
        price: detail.price,
        location: "Fort Wayne, IN", // You can extract real location if desired
        platform: "Facebook",
        motivationScore: score,
        createdAt: new Date().toISOString()
      });

      await detailPage.close();
    } catch (err) {
      console.error("❌ Error processing listing:", listing.url, err.message);
    }
  }

  const jsonPath = path.join(__dirname, "scraped-facebook-leads.json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`✅ Saved ${results.length} scraped Facebook leads to scraped-facebook-leads.json`);

  await browser.close();
})();
