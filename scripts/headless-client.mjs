// Headless browser driver for testing in game. Usage:
//   node scripts/headless-client.mjs <user> [dir]     (server on http://localhost:8888)
// Logs in as <user> (password "test"), then executes the lines appended to <dir>/cmd:
//   say <text>        type text into the chat box and press Enter (e.g. say ::~relic_demo)
//   key <name>        press a key        click <x> <y>   click in client pixels (765x503)
//   shot <name>       save <dir>/<name>.png   wait <ms>   quit
// Writes progress to <dir>/driver.log. Playwright comes from /opt/node-tools (cloud container).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? '/opt/node-tools/node_modules/playwright');

const user = process.argv[2] ?? 'relic1';
const dir = process.argv[3] ?? '/tmp/claude-0/drv';
const url = process.env.CLIENT_URL ?? 'http://localhost:8888/rs2.cgi';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/cmd`, '');
fs.writeFileSync(`${dir}/pid`, String(process.pid));
const log = (m) => fs.appendFileSync(`${dir}/driver.log`, m + '\n');

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto(url);
await page.waitForTimeout(8000);
const box = await page.locator('canvas').first().boundingBox();
const click = async (x, y) => { await page.mouse.move(box.x + x, box.y + y); await page.waitForTimeout(100); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up(); };
log(`canvas ${JSON.stringify(box)}`);

// login: Existing User, username, password
await click(462, 292); await page.waitForTimeout(500);
await page.keyboard.type(user); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
await page.keyboard.type('test');
await click(302, 322); // Login button
await page.waitForTimeout(8000);
await page.screenshot({ path: `${dir}/login.png` });
await click(150, 435); // focus the canvas (chat input) so typed keys register
log('login sent');

let offset = 0;
for (;;) {
  const lines = fs.readFileSync(`${dir}/cmd`, 'utf8').split('\n');
  const done = lines.length - 1;
  for (; offset < done; offset++) {
    const [c, ...rest] = lines[offset].split(' ');
    const arg = rest.join(' ');
    log(`> ${lines[offset]}`);
    if (c === 'say') { await page.keyboard.type(arg, { delay: 40 }); await page.keyboard.press('Enter'); }
    else if (c === 'type') await page.keyboard.type(arg, { delay: 40 });
    else if (c === 'key') await page.keyboard.press(arg);
    else if (c === 'click') { const [x, y] = arg.split(' ').map(Number); await click(x, y); }
    else if (c === 'shot') await page.screenshot({ path: `${dir}/${arg}.png` });
    else if (c === 'wait') await page.waitForTimeout(Number(arg));
    else if (c === 'quit') { await browser.close(); process.exit(0); }
  }
  await page.waitForTimeout(200);
}
