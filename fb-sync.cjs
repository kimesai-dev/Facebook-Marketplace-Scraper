// fb-sync.cjs
require('dotenv').config()

const puppeteer = require('puppeteer')
const fs        = require('fs')
const path      = require('path')
const axios     = require('axios')
const winston   = require('winston')
// ─── 1. LOGGER ───────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [ new winston.transports.Console() ]
});

// ─── 2. ENV CHECK ─────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  logger.error('❌ Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

// ─── 3. CONSTS/HELPERS ───────────────────────────────────────────────────────
const SEARCH_URL    = 'https://www.facebook.com/marketplace/fortwayne/search/?query=house%20for%20sale%20by%20owner';
const COOKIES_PATH  = path.join(__dirname, 'fb-cookies.json');
const ATTEMPT_LIMIT = 3;
const MAX_IMAGES    = 5;
// your CRM is on port 3000
const CRM_ENDPOINT  = process.env.CRM_ENDPOINT || 'http://localhost:3000/api/leads/import';

const delay       = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = () => delay(1000 + Math.floor(Math.random() * 2000));

// ─── 4. AXIOS INTERCEPTORS ──────────────────────────────────────────────────
axios.interceptors.request.use(cfg => {
  logger.debug('→ AXIOS REQUEST', {
    method: cfg.method,
    url: cfg.url,
    data: cfg.data,
  });
  return cfg;
});
axios.interceptors.response.use(
  res => {
    logger.debug('← AXIOS RESPONSE', { status: res.status, url: res.config.url });
    return res;
  },
  err => {
    logger.error('← AXIOS ERROR', {
      url: err.config?.url,
      status: err.response?.status,
      message: err.message,
      responseData: err.response?.data
    });
    return Promise.reject(err);
  }
);

// ─── 5. GPT ANALYSIS ──────────────────────────────────────────────────────────
async function analyzeWithGPT(base64Images, title, description, priceText) {
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text:
        `You are analyzing a real estate listing. Use title, description, price, and all images together.

Listing Title: ${title}
Listing Description: ${description}
Asking Price: ${priceText}

Return only this JSON:
{
  "motivation_score": 1-10,
  "rehab_level": "low"|"medium"|"high",
  "location_clue": "...",
  "show_me_why": "..."
}`
      },
      ...base64Images.map(b64 => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${b64}` }
      }))
    ]
  }];

  for (let i = 0; i < ATTEMPT_LIMIT; i++) {
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model: 'gpt-4o', messages, temperature: 0.4 },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          timeout: 15000
        }
      );

      const raw = res.data.choices[0].message.content;
      const match = raw.match(/\{[\s\S]*?\}/);
      const parsed = match ? JSON.parse(match[0]) : null;

      if (
        parsed &&
        typeof parsed.motivation_score === 'number' &&
        typeof parsed.rehab_level     === 'string' &&
        typeof parsed.location_clue   === 'string' &&
        typeof parsed.show_me_why     === 'string'
      ) {
        logger.info('🧠 GPT parsed JSON', parsed);
        return parsed;
      }
      throw new Error('Invalid GPT JSON');
    } catch (err) {
      logger.warn(`❌ GPT error (attempt ${i+1}): ${err.message}`);
      const retryMatch = err.message.match(/try again in ([\d.]+)s/i);
      await delay(retryMatch ? +retryMatch[1] * 1000 : 3000);
    }
  }
  return null;
}

// ─── 6. AUTO SCROLL ───────────────────────────────────────────────────────────
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0, step = 500;
      const iv = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= 8000) clearInterval(iv), resolve();
      }, 500);
    });
  });
}

// ─── 7. MAIN ─────────────────────────────────────────────────────────────────
;(async () => {
  logger.info('🟢 Starting fb-sync script');
  try {
    const browser = await puppeteer.launch({ headless: false, dumpio: true });
    const mainPage = await browser.newPage();

    if (fs.existsSync(COOKIES_PATH)) {
      const ck = JSON.parse(fs.readFileSync(COOKIES_PATH));
      await mainPage.setCookie(...ck);
    }

    logger.info('▶️ Navigating to Marketplace');
    await mainPage.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(await mainPage.cookies(), null, 2));

    await delay(4000);
    await autoScroll(mainPage);
    logger.info('✔️ Marketplace loaded & scrolled');

    const links = await mainPage.$$eval(
      'a[href*="/marketplace/item/"]',
      els => Array.from(new Set(els.map(a => a.href.split('?')[0])))
    );
    logger.info(`✅ Found ${links.length} listings`);

    for (const link of links) {
      logger.info('🔗 Processing listing', { link });
      await randomDelay();

      let attempt = 0, success = false;
      while (attempt < ATTEMPT_LIMIT && !success) {
        attempt++;
        const page = await browser.newPage();

        try {
          await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForSelector('body', { timeout: 10000 });

          const { title, description, priceText, imageUrls, base64Images } =
            await page.evaluate((MAX) => {
              const allText = Array.from(document.querySelectorAll('span,div'))
                .map(el => el.innerText.trim()).filter(Boolean);
              const priceText = allText.find(t => /^\$\d+(?:,\d{3})*(?:\.\d{2})?$/.test(t)) || null;
              const description = allText.find(t =>
                t.length > 30 && t.length < 500 &&
                !/notification|facebook|memories|birthday/i.test(t)
              ) || null;
              const imgs = Array.from(document.querySelectorAll('img'))
                .filter(i =>
                  i.src.includes('scontent') &&
                  !i.src.includes('/emoji/') &&
                  i.naturalWidth >= 200 && i.naturalHeight >= 200
                ).slice(0, MAX);
              async function toB64(url) {
                const r = await fetch(url);
                const blob = await r.blob();
                return new Promise(res => {
                  const fr = new FileReader();
                  fr.onloadend = () => res(fr.result.split(',')[1]);
                  fr.readAsDataURL(blob);
                });
              }
              const base64Images = [];
              return Promise.all(imgs.map(i =>
                toB64(i.src).then(b64 => base64Images.push(b64)).catch(() => {})
              ))
              .then(() => ({
                title: document.title,
                description,
                priceText,
                imageUrls: imgs.map(i => i.src),
                base64Images
              }));
            }, MAX_IMAGES);

          if (!description || !priceText || imageUrls.length === 0) {
            throw new Error('Insufficient data for GPT analysis');
          }

          // 1️⃣ GPT analysis
          const ai = await analyzeWithGPT(base64Images, title, description, priceText);
          if (!ai) throw new Error('GPT returned no valid JSON');

          // 2️⃣ Send to CRM
          const numericPrice = parseInt(priceText.replace(/[^\d]/g, ''), 10);
          const payload = {
            link,
            title,
            description,
            price: numericPrice,              // numeric price
            images: imageUrls,
            ai,
            source: 'facebook-marketplace',    // add required metadata
            createdAt: new Date().toISOString()
          };

          try {
            const crmRes = await axios.post(CRM_ENDPOINT, payload, { timeout: 10000 });
            logger.info('✅ Sent to CRM', { status: crmRes.status, link });
            success = true;
          } catch (err) {
            logger.error('🚨 CRM rejected payload', {
              status: err.response?.status,
              body:   err.response?.data
            });
            if (attempt < ATTEMPT_LIMIT) {
              await delay(2000);
            } else {
              throw err;
            }
          }
        } catch (err) {
          logger.warn(`⚠️ Attempt ${attempt} failed: ${err.message}`);
          if (attempt >= ATTEMPT_LIMIT) throw err;
        } finally {
          await page.close();
        }
      }
    }

    await browser.close();
    logger.info('🟢 fb-sync script complete');
  } catch (err) {
    logger.error('💥 Fatal error in fb-sync', { stack: err.stack });
    process.exit(1);
  }
})();
