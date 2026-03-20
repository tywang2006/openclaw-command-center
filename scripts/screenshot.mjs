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
  console.log('01. Login screen...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-login.png') });

  // 2. Login
  console.log('02. Logging in...');
  const pwInput = page.locator('input[type="password"]');
  if (await pwInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pwInput.fill(PASSWORD);
    const loginBtn = page.locator('button').filter({ hasText: /登录|Login/ }).first();
    await loginBtn.click();
    await page.waitForTimeout(4000);
  }

  // 3. Pixel office (dark theme, default view)
  console.log('03. Pixel office (dark)...');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-office-dark.png') });

  // 4. Select first department to show chat
  console.log('04. Chat...');
  const firstDeptCard = page.locator('.dept-card').first();
  if (await firstDeptCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstDeptCard.click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-chat.png') });

  // 5. Meeting tab
  console.log('05. Meeting...');
  await clickTab(page, '会议');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-meeting.png') });

  // 6. Activity tab
  console.log('06. Activity...');
  await clickTab(page, '动态');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-activity.png') });

  // 7. Memory tab
  console.log('07. Memory...');
  await clickTab(page, '记忆');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-memory.png') });

  // 8. Skills tab
  console.log('08. Skills...');
  await clickTab(page, '技能');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-skills.png') });

  // 9. Integrations tab
  console.log('09. Integrations...');
  await clickTab(page, '集成');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-integrations.png') });

  // 10. Guide tab
  console.log('10. Guide...');
  await clickTab(page, '指南');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-guide.png') });

  // --- Ops Console screenshots ---
  console.log('11. Ops Console - Dashboard...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/dashboard'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10-ops-dashboard.png') });

  console.log('12. Ops Console - System...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/system'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '11-ops-system.png') });

  console.log('13. Ops Console - Cron...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/cron'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '12-ops-cron.png') });

  console.log('14. Ops Console - Agents...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/agents'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '13-ops-agents.png') });

  console.log('15. Ops Console - Gateways...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/gateways'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '14-ops-gateways.png') });

  console.log('16. Ops Console - Activity...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/activity'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '15-ops-activity.png') });

  console.log('17. Ops Console - Approvals...');
  await page.goto(BASE_URL.replace('/cmd/', '/cmd/ops/approvals'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '16-ops-approvals.png') });

  // Light theme + office view
  console.log('18. Light theme...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const themeBtn = page.locator('.theme-toggle');
  if (await themeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await themeBtn.click();
    await page.waitForTimeout(500);
  }
  await clickTab(page, '对话');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '17-office-light.png') });

  // Switch theme back
  if (await themeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await themeBtn.click();
    await page.waitForTimeout(300);
  }

  await ctx.close();

  // --- Mobile (390x844, iPhone-like) ---
  console.log('19. Mobile screenshots...');
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
  await mp.screenshot({ path: path.join(SCREENSHOTS_DIR, '18-mobile.png') });

  // Mobile: open hamburger menu if exists
  const hamburger = mp.locator('.mobile-menu-btn, .hamburger, [class*="menu-toggle"]').first();
  if (await hamburger.isVisible({ timeout: 2000 }).catch(() => false)) {
    await hamburger.click();
    await mp.waitForTimeout(1000);
    await mp.screenshot({ path: path.join(SCREENSHOTS_DIR, '19-mobile-menu.png') });
  }

  await mobileCtx.close();
  await browser.close();

  console.log('\nDone! 19 screenshots saved to docs/screenshots/');
}

takeScreenshots().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
