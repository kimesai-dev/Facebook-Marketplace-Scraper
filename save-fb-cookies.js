require('dotenv').config()
const puppeteer = require('puppeteer')
const fs        = require('fs')
const path      = require('path')

;(async () => {
  console.log('🔑 Launching browser — please log in to Facebook when it opens...')
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  })
  const page = await browser.newPage()

  await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' })

  console.log('⏳ You have 60 seconds to complete the Facebook login…')
  await new Promise(resolve => setTimeout(resolve, 60000))

  const cookies = await page.cookies()
  const outPath = path.join(__dirname, 'fb-cookies.json')
  fs.writeFileSync(outPath, JSON.stringify(cookies, null, 2))
  console.log('✅ Saved', cookies.length, 'cookies to', outPath)

  await browser.close()
  process.exit(0)
})().catch(err => {
  console.error('💥 Error in save-fb-cookies.js:', err)
  process.exit(1)
})