#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const winston = require('winston');
const OpenAI = require('openai');

// ——— logger ———
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [ new winston.transports.Console() ],
});

// ——— paths & clients ———
const ROOT = process.cwd();
const COOKIES_PATH = path.join(ROOT, 'fb-cookies.json');
const SCREENSHOTS = path.join(ROOT, 'screenshots');
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;
        if (total >= 5000) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

;(async () => {
  logger.info('🚀 Launching browser…');
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // — load cookies
  let cookies = [];
  if (fs.existsSync(COOKIES_PATH)) {
    cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    await page.setCookie(...cookies);
    logger.info('✅ Facebook cookies loaded');
  }

  await page.goto('https://www.facebook.com/marketplace/fortwayne/search/?query=house%20for%20sale%20by%20owner', { waitUntil: 'networkidle2' });
  await delay(4000);

  // — login if needed
  if (await page.$('input[name="email"]')) {
    logger.info('🔐 Logging in...');
    await page.type('input[name="email"]', process.env.FB_EMAIL, { delay: 50 });
    await page.type('input[name="pass"]', process.env.FB_PASSWORD, { delay: 50 });
    await Promise.all([
      page.click('button[name="login"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);
    cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    logger.info('✅ Logged in & cookies saved');
  }

  logger.info('📜 Scrolling Marketplace...');
  await autoScroll(page);
  await delay(2000);

  const listings = await page.$$eval('a[href*="/marketplace/item/"]', anchors =>
    [...new Set(anchors.map(a => a.href))].slice(0, 20)
  );

  logger.info(`📦 Found ${listings.length} listings`);
  const leads = [];

  for (let i = 0; i < listings.length; i++) {
    const link = listings[i];
    logger.info(`\n🔗 Processing listing ${i + 1}: ${link}`);

    try {
      const tab = await browser.newPage();
      await tab.setCookie(...cookies);
      await tab.goto(link, { waitUntil: 'domcontentloaded' });
      await delay(5000);
      await tab.evaluate(() => window.scrollBy(0, 500));
      await tab.waitForSelector('h1, div[role="heading"]', { timeout: 7000 }).catch(() => {});

      const title = await tab.evaluate(() => {
        const el = document.querySelector('h1, div[role="heading"]');
        return el?.innerText || '';
      });

      const description = await tab.evaluate(() => {
        const el = document.querySelector('[data-testid*="description"], div[aria-label="Description"]');
        return el?.innerText || '';
      });

      const priceText = await tab.evaluate(() => {
        const candidates = [...document.querySelectorAll('span, div')];
        const match = candidates.find(el => el.textContent.includes('$') && el.textContent.length < 20);
        return match?.innerText || '';
      });

      if (!title && !description && !priceText) {
        logger.warn('⚠️ Could not extract title, description, or price — skipping');
        await tab.close();
        continue;
      }

      logger.info(`📌 Title: ${title}`);
      logger.info(`💬 Description: ${description}`);
      logger.info(`💲 Price: ${priceText}`);

      await tab.waitForSelector('img[src*="scontent"]', { timeout: 8000 }).catch(() => {});
      const images = await tab.evaluate(() => {
        const seen = new Set();
        const gallery = [...document.querySelectorAll('img[src*="scontent"]')];
        const visible = gallery.filter(img => {
          const r = img.getBoundingClientRect();
          return r.width > 250 && r.height > 250 && !seen.has(img.src) && seen.add(img.src);
        });
        return visible.map(img => img.src).slice(0, 3);
      });

      if (images.length === 0) {
        logger.warn('⚠️ No valid listing images found for GPT Vision.');
        await tab.close();
        continue;
      }

      logger.info(`🖼️ Found ${images.length} image(s)`);

      const debugPath = path.join(SCREENSHOTS, `debug-${i + 1}.png`);
      await tab.screenshot({ path: debugPath, fullPage: true });
      logger.info(`🧪 Screenshot saved to: ${debugPath}`);

      const imageBuffers = await Promise.all(
        images.map(async (src) => {
          const response = await axios.get(src, { responseType: 'arraybuffer' });
          const base64 = Buffer.from(response.data, 'binary').toString('base64');
          return {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` }
          };
        })
      );

      const visionRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a real estate AI. Evaluate listing photos + text for signs of seller distress, repairs, and potential deals. Give a short summary and motivation score from 1–10.`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Title: ${title}\nDescription: ${description}\nPrice: ${priceText}` },
              ...imageBuffers
            ]
          }
        ],
        temperature: 0.2,
        max_tokens: 600,
      });

      let motivation = "Unknown";
      let summary = "No GPT summary returned.";
      if (visionRes?.choices?.[0]?.message?.content) {
        summary = visionRes.choices[0].message.content.trim();
        const match = summary.match(/Motivation Score[:\s]+(\d+\/10|\d+)/i);
        if (match) motivation = match[1].replace("/10", "");
        logger.info(`🧠 GPT Vision Output:\n${summary}`);
      }

      leads.push({
        id: `lead-${i + 1}`,
        title,
        description,
        location: "Fort Wayne, IN",
        motivation,
        price: priceText,
        link,
        summary
      });

      await tab.close();
    } catch (err) {
      logger.error(`❌ Error processing listing ${i + 1}: ${err.message}`);
    }
  }

  // ✅ Send leads to CRM
  try {
    const response = await axios.post("https://freedom-backend-production.up.railway.app/api/leads/import", leads);
    console.log(`✅ Successfully pushed ${leads.length} leads to CRM: ${response.status}`);
  } catch (err) {
    console.error("❌ Failed to push leads to CRM:", err.message);
  }
  

  await browser.close();
  logger.info('✅ All done!');
})();
