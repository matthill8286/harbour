import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webUrl = process.env.HARBOUR_WEB_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.HARBOUR_API_URL ?? 'http://127.0.0.1:3001';
const outDir = join(root, 'docs/pitch');
const videoDir = join(root, '.demo-output');

const OWNER = {
  email: 'owner@cyprus-auto.local',
  password: 'ChangeMe!Admin1',
};
const STAFF = {
  name: 'Kyriakos',
  email: 'kyriakos@cyprus-auto.local',
  password: 'ChangeMe!Staff1',
};
const CUSTOMER = {
  firstName: 'Elena',
  lastName: 'Constantinou',
  email: 'elena@example.com',
  phone: '+357 99 441122',
};
const TRACKER = 'TRK-140';
const PLATE = 'RJ14 XOO';

function requirePlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    join(root, 'node_modules/playwright'),
    '/tmp/harbour-playwright/node_modules/playwright',
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* try next */
    }
  }
  return require('playwright');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(
  url,
  label,
  ok = (res) => res.ok || res.status < 500,
) {
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(url);
      if (ok(response)) return;
    } catch {
      /* still booting */
    }
    await sleep(1000);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function caption(page, kicker, title) {
  await page.evaluate(
    ({ kicker: nextKicker, title: nextTitle }) => {
      if (!document.getElementById('harbour-demo-caption-style')) {
        const style = document.createElement('style');
        style.id = 'harbour-demo-caption-style';
        style.textContent = `
          #harbour-demo-caption {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483000;
            min-width: 380px;
            max-width: 640px;
            padding: 8px 16px 10px;
            border-radius: 14px;
            background: rgba(11, 31, 51, 0.94);
            color: #fffaf2;
            box-shadow: 0 10px 30px rgba(11, 31, 51, 0.28);
            pointer-events: none;
            font-family: "Nunito Sans", ui-sans-serif, system-ui, sans-serif;
          }
          #harbour-demo-caption .kicker {
            margin: 0;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #f4ead7;
          }
          #harbour-demo-caption .title {
            margin: 2px 0 0;
            font-size: 15px;
            font-weight: 600;
          }
        `;
        document.head.appendChild(style);
      }
      let bar = document.getElementById('harbour-demo-caption');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'harbour-demo-caption';
        bar.setAttribute('aria-hidden', 'true');
        bar.innerHTML = '<p class="kicker"></p><p class="title"></p>';
        document.body.appendChild(bar);
      }
      bar.querySelector('.kicker').textContent = nextKicker;
      bar.querySelector('.title').textContent = nextTitle;
    },
    { kicker, title },
  );
}

async function clearAndType(locator, text, delay = 42) {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay });
}

function rail(page) {
  return page.locator('.staff-rail');
}

function shell(page) {
  return page.locator('.staff-shell');
}

const CARD_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 72px 88px 64px;
        background: #0b1f33;
        color: #fffaf2;
        font-family: "Nunito Sans", ui-sans-serif, system-ui, sans-serif;
      }
      .kicker {
        letter-spacing: 0.28em;
        text-transform: uppercase;
        font-size: 13px;
        color: #f4ead7;
      }
      h1 {
        font-family: Georgia, "Times New Roman", serif;
        font-size: 72px;
        font-weight: 500;
        letter-spacing: -0.03em;
        margin: 28px 0 0;
      }
      p.lede {
        margin-top: 24px;
        max-width: 820px;
        font-size: 28px;
        line-height: 1.35;
        color: rgba(255,250,242,0.78);
      }
      .meta { font-size: 16px; color: rgba(255,250,242,0.62); }
    </style>
  </head>
  <body>
    <div>
      <p class="kicker">Harbour · importer workspace</p>
      <h1>From empty desk to live GPS</h1>
      <p class="lede">A company sets up its workspace, adds Kyriakos to the team, books a customer’s BMW M3, assigns a tracker, and watches the corridor move.</p>
    </div>
    <p class="meta">Cyprus Auto Logistics · RJ14 XOO</p>
  </body>
</html>`;

const END_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 72px 88px 64px;
        background: #0b1f33;
        color: #fffaf2;
        font-family: "Nunito Sans", ui-sans-serif, system-ui, sans-serif;
      }
      .kicker {
        letter-spacing: 0.28em;
        text-transform: uppercase;
        font-size: 13px;
        color: #f4ead7;
      }
      h1 {
        font-family: Georgia, "Times New Roman", serif;
        font-size: 64px;
        font-weight: 500;
        letter-spacing: -0.03em;
        margin: 28px 0 0;
      }
      ul {
        margin: 36px 0 0;
        padding: 0;
        list-style: none;
        font-size: 24px;
        line-height: 1.7;
        color: rgba(255,250,242,0.82);
      }
    </style>
  </head>
  <body>
    <div>
      <p class="kicker">Harbour</p>
      <h1>The M3 is on the map</h1>
      <ul>
        <li>Company workspace live</li>
        <li>Kyriakos on the desk</li>
        <li>Elena Constantinou’s BMW M3 · RJ14 XOO</li>
        <li>Tracker TRK-140 pinging the UK → Cyprus corridor</li>
      </ul>
    </div>
  </body>
</html>`;

async function record() {
  const { chromium } = requirePlaywright();
  await mkdir(videoDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  await waitForHttp(`${apiUrl}/api/health`, 'API');
  await waitForHttp(webUrl, 'Web');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: videoDir,
      size: { width: 1920, height: 1080 },
    },
  });

  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      #harbour-demo-caption {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483000;
        min-width: 420px;
        max-width: 720px;
        padding: 10px 18px 12px;
        border-radius: 16px;
        background: rgba(11, 31, 51, 0.92);
        color: #fffaf2;
        box-shadow: 0 10px 30px rgba(11, 31, 51, 0.28);
        pointer-events: none;
        font-family: "Nunito Sans", ui-sans-serif, system-ui, sans-serif;
      }
      #harbour-demo-caption .kicker {
        margin: 0;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #f4ead7;
      }
      #harbour-demo-caption .title {
        margin: 3px 0 0;
        font-size: 16px;
        font-weight: 600;
      }
      #harbour-demo-cursor {
        position: fixed;
        width: 18px;
        height: 18px;
        border: 2px solid #1c6b6a;
        background: rgba(28, 107, 106, 0.35);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 2147483647;
      }
    `;
    document.documentElement.appendChild(style);
    const move = (event) => {
      let cursor = document.getElementById('harbour-demo-cursor');
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = 'harbour-demo-cursor';
        document.documentElement.appendChild(cursor);
      }
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    };
    window.addEventListener('mousemove', move, true);
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  try {
    await page.setContent(CARD_HTML, { waitUntil: 'domcontentloaded' });
    await sleep(3200);

    await page.goto(`${webUrl}/login`, { waitUntil: 'networkidle' });
    await caption(
      page,
      'Step 1',
      'The importer signs in to their Harbour workspace',
    );
    await sleep(900);
    await clearAndType(page.getByLabel('Email'), OWNER.email);
    await clearAndType(page.getByLabel('Password'), OWNER.password, 28);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await page.getByRole('heading', { name: 'Board' }).waitFor();
    await caption(
      page,
      'Workspace',
      'A new tenant starts empty — jobs, customers and GPS stay inside this company',
    );
    await sleep(2000);

    await caption(
      page,
      'Step 2',
      'Add the company: brand, legal name, timezone and currency',
    );
    await rail(page).getByRole('link', { name: 'Workspace' }).click();
    await page.getByRole('heading', { name: 'Workspace' }).waitFor();
    await sleep(600);
    await clearAndType(
      page.getByLabel('Workspace name'),
      'Cyprus Auto Logistics',
    );
    await clearAndType(
      page.getByLabel('Legal name'),
      'Cyprus Auto Logistics Ltd',
    );
    await clearAndType(
      page.getByLabel('Internal name'),
      'Cyprus Auto Logistics',
    );
    await page.getByLabel('Timezone').selectOption('Europe/Nicosia');
    await page.getByLabel('Currency').selectOption('EUR');
    await page.getByLabel('Country').selectOption('CY');
    await page.getByRole('button', { name: 'Save workspace' }).click();
    await page.getByText('Workspace saved').waitFor();
    await sleep(1400);

    await caption(
      page,
      'Step 3',
      'Invite Kyriakos as staff on the company desk',
    );
    await page.getByRole('heading', { name: 'Team' }).scrollIntoViewIfNeeded();
    await clearAndType(page.getByLabel('Name', { exact: true }), STAFF.name);
    await clearAndType(page.getByLabel('Email'), STAFF.email);
    await page.getByLabel('Role').selectOption('STAFF');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const inviteBox = page.locator('p.break-all');
    await inviteBox.waitFor();
    const inviteUrl = (await inviteBox.textContent())?.trim();
    if (!inviteUrl) throw new Error('Invite URL was not shown');
    const kyriakosRow = shell(page)
      .locator('li')
      .filter({ hasText: STAFF.email });
    await kyriakosRow.waitFor();
    await kyriakosRow.scrollIntoViewIfNeeded();
    await sleep(1800);

    await caption(
      page,
      'Step 4',
      'Kyriakos accepts the invite and joins the desk',
    );
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/);
    await page.goto(inviteUrl, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Welcome, Kyriakos/ }).waitFor();
    await sleep(700);
    await clearAndType(
      page.getByLabel('Password', { exact: true }),
      STAFF.password,
      28,
    );
    await clearAndType(page.getByLabel('Confirm password'), STAFF.password, 28);
    await page.getByRole('button', { name: 'Join team' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await shell(page)
      .locator('header')
      .getByText(STAFF.name, { exact: true })
      .waitFor();
    await caption(
      page,
      'Desk',
      'Kyriakos is on the company workspace and can run import operations',
    );
    await sleep(1800);

    await caption(page, 'Step 5', 'Add the customer who owns the vehicle');
    await rail(page).getByRole('link', { name: 'Customers' }).click();
    await page.getByRole('heading', { name: 'Customers' }).waitFor();
    await clearAndType(page.getByPlaceholder('First name'), CUSTOMER.firstName);
    await clearAndType(page.getByPlaceholder('Last name'), CUSTOMER.lastName);
    await clearAndType(page.getByPlaceholder('Email'), CUSTOMER.email);
    await clearAndType(page.getByPlaceholder('Phone'), CUSTOMER.phone);
    await page.getByRole('button', { name: 'Add customer' }).click();
    await page.getByRole('link', { name: 'Elena Constantinou' }).waitFor();
    await sleep(1600);

    await caption(
      page,
      'Step 6',
      'Register a GPS tracker for this organisation',
    );
    await rail(page).getByRole('link', { name: 'Trackers' }).click();
    await page.getByRole('heading', { name: 'Trackers' }).waitFor();
    await clearAndType(page.getByPlaceholder('IMEI'), TRACKER, 55);
    await page.locator('select').selectOption('generic');
    await page.getByRole('button', { name: 'Register unit' }).click();
    await shell(page).getByText(TRACKER, { exact: true }).waitFor();
    await shell(page)
      .getByText(/Demo simulator/i)
      .first()
      .waitFor();
    await sleep(1600);

    await caption(
      page,
      'Step 7',
      'Create the import job for Elena’s BMW M3 · RJ14 XOO',
    );
    await page.getByRole('link', { name: 'New job' }).click();
    await page.getByRole('heading', { name: 'New import job' }).waitFor();
    await page
      .getByLabel('Existing customer')
      .selectOption({ label: 'Elena Constantinou' });
    await sleep(400);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Vehicle' }).waitFor();
    await clearAndType(page.getByPlaceholder('KN19 XPL'), PLATE, 70);
    await page.getByRole('button', { name: 'Look up vehicle' }).click();
    await page.getByRole('heading', { name: 'Confirm job' }).waitFor();
    await page
      .getByRole('heading', { name: 'Confirm job' })
      .locator('..')
      .getByText('BMW M3')
      .waitFor();
    await page
      .getByRole('heading', { name: 'Confirm job' })
      .locator('..')
      .getByText('RJ14 XOO')
      .waitFor();
    await page.getByLabel('Expected delivery').fill('2026-10-20');
    await sleep(1000);
    await page.getByRole('button', { name: 'Create import job' }).click();
    await page.waitForURL(/\/jobs\//);
    await shell(page).locator('h1').getByText('BMW M3').waitFor();
    await shell(page).getByText('RJ14 XOO').first().waitFor();
    await sleep(1400);

    await caption(
      page,
      'Step 8',
      'Assign the tracker to the M3 and move the job onto the corridor',
    );
    await page.getByRole('tab', { name: 'Tracking' }).click();
    await page.getByRole('heading', { name: 'Live GPS' }).waitFor();
    const trackerSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: TRACKER }) });
    await trackerSelect.scrollIntoViewIfNeeded();
    const trackerValue = await trackerSelect
      .locator('option')
      .filter({ hasText: TRACKER })
      .getAttribute('value');
    if (!trackerValue) throw new Error('Tracker option missing');
    await trackerSelect.selectOption(trackerValue);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await shell(page)
      .getByText(new RegExp(`Tracker\\s+${TRACKER}`))
      .waitFor();
    await sleep(900);

    for (const status of [
      'Confirmed',
      'Ready for collection',
      'Collected',
      'In transit (UK)',
    ]) {
      await page.getByRole('button', { name: status, exact: true }).click();
      await page
        .locator('.job-chrome-header')
        .getByText(status, { exact: true })
        .waitFor();
      await sleep(650);
    }

    await caption(
      page,
      'Step 9',
      'Simulate GPS: the M3 pings along the UK → Cyprus corridor',
    );
    await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Advance GPS' }).waitFor();
    for (let i = 0; i < 12; i += 1) {
      await page
        .getByRole('button', { name: 'Advance GPS' })
        .evaluate((button) => button.click());
      await page.getByRole('button', { name: 'Advance GPS' }).waitFor();
      await sleep(750);
    }
    await page.locator('.leaflet-container').waitFor();
    await sleep(1800);

    await caption(
      page,
      'Step 10',
      'The live fleet map now shows RJ14 XOO moving',
    );
    await page.getByRole('link', { name: 'Open on fleet map' }).click();
    await page.waitForURL(/\/tracking/);
    await shell(page)
      .getByText(/BMW M3/)
      .first()
      .waitFor();
    const m3Row = page
      .locator('.fleet-sidebar-item')
      .filter({ hasText: 'BMW M3' });
    if (await m3Row.count()) {
      await m3Row.first().click();
    }
    await page.locator('.leaflet-container').waitFor();
    await sleep(6500);

    await page.setContent(END_HTML, { waitUntil: 'domcontentloaded' });
    await sleep(3600);
  } catch (error) {
    await page.screenshot({
      path: join(outDir, 'harbour-company-workflow-failure.png'),
      fullPage: true,
    });
    throw error;
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const recorded = await video.path();
      const webm = join(outDir, 'harbour-company-workflow.webm');
      await copyFile(recorded, webm);
      const mp4 = join(outDir, 'harbour-company-workflow.mp4');
      try {
        await run('ffmpeg', [
          '-y',
          '-i',
          webm,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          mp4,
        ]);
        console.log(`Wrote ${mp4}`);
      } catch {
        console.log(`ffmpeg not available; left ${webm}`);
      }
    }
  }
}

await record();
