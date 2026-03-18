import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const BASE_URL = 'http://localhost:5100/cmd/';
const PASSWORD = 'f4c04a47b796aa07ad7249b6881e9280';

async function clickTab(page, tabLabel) {
  // Tabs are .right-tab buttons with <span>label</span>
  const tab = page.locator('.right-tab').filter({ hasText: tabLabel }).first();
  if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(1500);
    return true;
  }
  console.log(`  Tab "${tabLabel}" not found`);
  return false;
}

async function takeScreenshots() {
  const browser = await chromium.launch({ headless: true });

  // --- Desktop (1440x900, 2x DPR) ---
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  // 1. Login screen
  console.log('1. Login screen...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-login.png') });

  // 2. Login
  console.log('2. Logging in...');
  const pwInput = page.locator('input[type="password"]');
  if (await pwInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pwInput.fill(PASSWORD);
    const loginBtn = page.locator('button').filter({ hasText: /登录|Login/ }).first();
    await loginBtn.click();
    await page.waitForTimeout(4000);
  }

  // 3. Pixel office (dark theme, default view)
  console.log('3. Pixel office (dark)...');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-office-dark.png') });

  // 4. Select first department to show chat
  console.log('4. Selecting department...');
  const firstDeptCard = page.locator('.dept-card').first();
  if (await firstDeptCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstDeptCard.click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-chat.png') });

  // 5. Dashboard tab
  console.log('5. Dashboard...');
  await clickTab(page, '面板');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-dashboard.png') });

  // 6. Meeting tab
  console.log('6. Meeting...');
  await clickTab(page, '会议');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-meeting.png') });

  // 7. Cron tab
  console.log('7. Cron...');
  await clickTab(page, '定时');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-cron.png') });

  // 8. Workflows tab
  console.log('8. Workflows...');
  await clickTab(page, '流程');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-workflows.png') });

  // 9. Skills tab
  console.log('9. Skills...');
  await clickTab(page, '技能');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-skills.png') });

  // 10. System tab
  console.log('10. System...');
  await clickTab(page, '系统');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-system.png') });

  // 11. Integrations tab
  console.log('11. Integrations...');
  await clickTab(page, '集成');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10-integrations.png') });

  // 12. Guide tab
  console.log('12. Guide...');
  await clickTab(page, '指南');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '11-guide.png') });

  // 13. Light theme + office view
  console.log('13. Light theme...');
  const themeBtn = page.locator('.theme-toggle');
  if (await themeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await themeBtn.click();
    await page.waitForTimeout(500);
  }
  // Switch to chat tab to show office + chat
  await clickTab(page, '对话');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '12-office-light.png') });

  // Switch theme back for remaining shots
  if (await themeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await themeBtn.click();
    await page.waitForTimeout(300);
  }

  await ctx.close();

  // --- Mobile (390x844, iPhone-like) ---
  console.log('14. Mobile screenshots...');
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mobileCtx.newPage();
  await mp.goto(BASE_URL, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1500);

  // Mobile login
  const mobilePw = mp.locator('input[type="password"]');
  if (await mobilePw.isVisible({ timeout: 3000 }).catch(() => false)) {
    await mobilePw.fill(PASSWORD);
    const mobileLoginBtn = mp.locator('button').filter({ hasText: /登录|Login/ }).first();
    await mobileLoginBtn.click();
    await mp.waitForTimeout(4000);
  }

  // Mobile main view
  await mp.screenshot({ path: path.join(SCREENSHOTS_DIR, '13-mobile.png') });

  // Mobile: open hamburger menu if exists
  const hamburger = mp.locator('.mobile-menu-btn, .hamburger, [class*="menu-toggle"]').first();
  if (await hamburger.isVisible({ timeout: 2000 }).catch(() => false)) {
    await hamburger.click();
    await mp.waitForTimeout(1000);
    await mp.screenshot({ path: path.join(SCREENSHOTS_DIR, '14-mobile-menu.png') });
  }

  await mobileCtx.close();
  await browser.close();

  console.log('\nDone! Screenshots saved to docs/screenshots/');
}

takeScreenshots().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
