const { test, chromium } = require('@playwright/test');
const https = require('https');

const [email, password] = (process.env.DISCORD_ACCOUNT || ',').split(',');
const [panelUser, panelPass] = (process.env.PANEL_ACCOUNT || ',').split(',');
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');

const TIMEOUT = 60000;

// ====================== 🧯 关键修复：防超时 ======================
test.setTimeout(180000);

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sendTG(result, serverName = 'OptikLink') {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }

        const msg = [
            `🎮 OptikLink 保活通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: 新加坡`,
            `🖥 邮箱: ${serverName}`,
            `📊 执行结果: ${result}`,
        ].join('\n');

        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });

        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            console.log(res.statusCode === 200 ? '📨 TG 推送成功' : `⚠️ TG 推送失败：${res.statusCode}`);
            resolve();
        });

        req.on('error', () => resolve());
        req.setTimeout(15000, () => { req.destroy(); resolve(); });

        req.write(body);
        req.end();
    });
}

// Discord 登录
async function handleDiscordLogin(page, email, password) {
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    try {
        await page.waitForURL(url => !url.toString().includes('discord.com/login'), { timeout: 15000 });
    } catch {
        let err = '账密错误或触发了 2FA / 验证码';
        try { err = await page.locator('[class*="errorMessage"]').first().innerText(); } catch {}
        throw new Error(`❌ Discord 登录失败: ${err}`);
    }
}

// OAuth 处理（轻微增强防卡死）
async function handleOAuthPage(page) {
    await page.waitForTimeout(2000);

    for (let i = 0; i < 5; i++) {
        if (!page.url().includes('discord.com')) return;

        try {
            const btn = await page.waitForSelector('button.primary_a22cb0', { timeout: 3000 });
            const text = (await btn.innerText()).trim();

            if (/scroll/i.test(text) || text.includes('滚动')) {
                await page.evaluate(() => {
                    const s = document.querySelector('[class*="scroller"]')
                        || document.querySelector('[class*="scrollerBase"]')
                        || document.querySelector('[class*="content"]');
                    if (s) s.scrollTop = s.scrollHeight;
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await page.waitForTimeout(1200);
                await btn.click();
            } else if (/authorize/i.test(text) || text.includes('授权')) {
                await btn.click();
                await page.waitForTimeout(2000);
                return;
            }
        } catch {
            // ======================
            // 🧯 防死循环退出点
            // ======================
            try {
                await Promise.race([
                    page.waitForURL(url => !url.toString().includes('discord.com'), { timeout: 8000 }),
                    new Promise(r => setTimeout(r, 8000))
                ]);
            } catch {}
            return;
        }
    }
}

test('OptikLink 保活', async ({ }, testInfo) => {

    let finished = false;

    const proxyUrl = '';

    if (!email || !password) {
        throw new Error('❌ 缺少账号配置，格式: DISCORD_ACCOUNT=email,password');
    }

    let proxyConfig = undefined;
    if (process.env.GOST_PROXY) {
        try {
            const http = require('http');
            await new Promise((resolve, reject) => {
                const req = http.request(
                    { host: '127.0.0.1', port: 8080, path: '/', method: 'GET', timeout: 3000 },
                    () => resolve()
                );
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                req.end();
            });
            proxyConfig = { server: process.env.GOST_PROXY };
            console.log('🛡️ 本地代理连通，使用 GOST 转发');
        } catch {
            console.log('⚠️ 本地代理不可达，降级为直连');
        }
    }

    console.log('🔧 启动浏览器...');
    const browser = await chromium.launch({
        headless: true,
        proxy: proxyConfig,
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);

    let activePage = page;

    await page.addInitScript(() => {
        if (!location.hostname.includes('optiklink.net')) return;
        const AD_DOMAINS = ['tzegilo.com','alwingulla.com','auqot.com','jmosl.com','094kk.com'];
        const isAd = (url) => url && AD_DOMAINS.some(d => url.includes(d));
        const _fetch = window.fetch;
        window.fetch = (url, ...args) =>
            isAd(typeof url === 'string' ? url : url?.url)
                ? Promise.reject()
                : _fetch.call(window, url, ...args);
    });

    try {
        console.log('🌐 打开 OptikLink...');
        await page.goto('https://optiklink.com/auth', { waitUntil: 'domcontentloaded' });

        console.log('📤 Login with Discord...');
        await page.click("a[href='login']");

        await page.waitForURL(url => !url.toString().includes('optiklink.com/auth'), { timeout: TIMEOUT });

        const landedUrl = page.url();

        // ======================
        // Discord 登录
        // ======================
        if (landedUrl.includes('discord.com/login')) {
            await page.fill('input[name="email"]', email);
            await page.fill('input[name="password"]', password);
            await page.click('button[type="submit"]');

            try {
                await page.waitForURL(url => !url.toString().includes('discord.com/login'), { timeout: 15000 });
            } catch {
                throw new Error('Discord 登录失败');
            }
        }

        // ======================
        // OAuth
        // ======================
        try {
            await page.waitForURL(/discord\.com\/oauth2/, { timeout: 6000 });
            await handleOAuthPage(page);
        } catch {}

        // ======================
        // 二次 login 防回跳
        // ======================
        if (page.url().includes('discord.com/login')) {
            await page.fill('input[name="email"]', email);
            await page.fill('input[name="password"]', password);
            await page.click('button[type="submit"]');

            try {
                await page.waitForURL(url => !url.toString().includes('login'), { timeout: 20000 });
            } catch {
                throw new Error('Discord 二次登录失败');
            }

            if (page.url().includes('oauth2')) {
                await handleOAuthPage(page);
            }
        }

        // ======================
        // 到达目标页
        // ======================
        await Promise.race([
            page.waitForURL(/optiklink\.net/, { timeout: 30000 }),
            new Promise(r => setTimeout(r, 30000))
        ]);

        if (!page.url().includes('optiklink.net')) {
            throw new Error(`未到达目标站: ${page.url()}`);
        }

        console.log(`✅ 登录成功！当前：${page.url()}`);

        await sendTG('✅ 保活成功！', email);

        finished = true;
        console.log('🏁 任务完成');
        return;

    } catch (e) {

        try {
            const screenshotPath = testInfo.outputPath('failure.png');
            await activePage.screenshot({ path: screenshotPath, fullPage: true });
            await testInfo.attach('failure', { path: screenshotPath, contentType: 'image/png' });
        } catch {}

        await sendTG(`❌ 脚本异常：${e.message}`);
        throw e;

    } finally {

        try {
            if (!finished) {
                console.log('⚠️ 未正常完成，强制结束');
            }
        } catch {}

        try {
            await Promise.race([
                browser.close(),
                new Promise(r => setTimeout(r, 5000))
            ]);
        } catch {}

        console.log('🚪 浏览器关闭');
    }
});
