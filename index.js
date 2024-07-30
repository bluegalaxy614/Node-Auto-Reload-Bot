const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const URL = 'https://fr.tlscontact.com/visa/dz/dzORN2fr/home';
const SELECTORS = {
  personalButton: '.button-neo-inside-primary',
  recaptchaResponse: '#g-recaptcha-response',
  submitButton: '#submit-button',
  emailInput: 'input[name="username"]',
  passwordInput: 'input[name="password"]',
  loginButton: 'button[type="submit"]'
};

async function solveRecaptcha(page) {
  const siteKey = await page.evaluate(() => {
    const recaptchaElement = document.querySelector('.g-recaptcha');
    return recaptchaElement ? recaptchaElement.getAttribute('data-sitekey') : null;
  });

  if (!siteKey) {
    console.error('Site key not found.');
    return;
  }

  const apiKey = process.env.TWOCAPTCHA_API_KEY; // Your 2Captcha API key

  try {
    const response = await axios.get(`http://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${page.url()}`);
    const requestId = response.data.split('|')[1];

    let solution;
    while (!solution) {
      const result = await axios.get(`http://2captcha.com/res.php?key=${apiKey}&action=get&id=${requestId}`);
      if (result.data.includes('OK')) {
        solution = result.data.split('|')[1];
      } else {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
      }
    }

    await page.evaluate(`document.getElementById('g-recaptcha-response').innerHTML="${solution}";`);
    await page.click(SELECTORS.submitButton);
  } catch (error) {
    console.error('Error solving reCAPTCHA:', error);
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en'
  });
  await page.setDefaultNavigationTimeout(300000);
  await page.goto(URL, { timeout: 300000 });

  try {
    while (true) {
      const content = await page.content();
      if (content.includes('Verifying you are human')) {
        console.log('You are on the "verify human" page now');
        await page.waitForSelector('.g-recaptcha', { timeout: 120000 }).catch(() => {}); // Wait up to 60 seconds for reCAPTCHA
        await page.waitForFunction(() => document.querySelector('.g-recaptcha') && document.querySelector('.g-recaptcha').getAttribute('data-sitekey'), { timeout: 120000 });
        await solveRecaptcha(page);
      }

      // Check if login is successful or if we need to reload
      if (content.includes('SE CONNECTER')) {
        console.log('You are in the home page now');
        await page.waitForSelector('.tls-navbar-right a', { visible: true });
        await page.evaluate(() => {
            const element = document.querySelector('.tls-navbar-right a');
            if (element) {
                element.scrollIntoView(); // Ensure the element is in view
                element.click(); // Click the element
            } else {
                console.error('Element not found');
            }
        });
      } else if (page.url().includes('Log in')) {
        console.log('You are on the login page now');
        await page.waitForSelector(SELECTORS.emailInput, { visible: true });
        await page.type(SELECTORS.emailInput, process.env.EMAIL);
        await page.type(SELECTORS.passwordInput, process.env.PASSWORD);
        await page.click(SELECTORS.loginButton);
      } else if (page.url().includes('personal')) {
        console.log('You are on the personal page now');
        await page.waitForSelector(SELECTORS.personalButton, { visible: true });
        await page.click(SELECTORS.personalButton);
      } else {
        await page.reload({ timeout: 120000 }); // Reload the page if none of the conditions are met
      }

      // Exit the loop if the page is closed or if the condition is met
      if (page.isClosed()) {
        console.log('Page is closed, stopping the loop');
        break;
      }

      // Optional: Add a delay to avoid rapid reloading or actions
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
    }

    console.log("Appointment is successfully reserved");
    await browser.close();
  } catch (error) {
    console.error('Error during navigation:', error);
    await browser.close();
  }
})();