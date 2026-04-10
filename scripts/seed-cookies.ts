#!/usr/bin/env tsx
/**
 * Local cookie seeder — run this on your own machine to get fresh Cloudflare cookies
 * and store them in Supabase so the Netlify deployment can use them.
 *
 * Usage:
 *   npm run seed-cookies
 *
 * Requirements:
 *   .env.local must contain:
 *     NEXT_PUBLIC_SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY
 *     DIJIDEMI_USERNAME
 *     DIJIDEMI_PASSWORD
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USERNAME = process.env.DIJIDEMI_USERNAME;
const PASSWORD = process.env.DIJIDEMI_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}
if (!USERNAME || !PASSWORD) {
    console.error('❌ Missing: DIJIDEMI_USERNAME and/or DIJIDEMI_PASSWORD in .env.local');
    process.exit(1);
}

const WANTED_COOKIES = ['cf_clearance', 'ASP.NET_SessionId', 'usrtkn', '.ASPXAUTH'];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

async function main() {
    console.log('🚀 Opening real Chrome to log in to dijidemi.com...');
    const browser = await chromium.launch({
        headless: false,
        args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 720 },
        locale: 'tr-TR',
        timezoneId: 'Europe/Istanbul',
    });

    const page = await context.newPage();

    console.log('   Navigating to dijidemi.com/login ...');
    await page.goto('https://www.dijidemi.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });

    // Wait for login form — if Cloudflare challenge appears, real Chrome will handle it automatically
    console.log('   Waiting for login form (Cloudflare may take a few seconds)...');
    await page.waitForSelector('#txtUserName', { state: 'visible', timeout: 60000 });

    console.log('   Filling credentials...');
    await page.fill('#txtUserName', USERNAME!);
    await page.fill('#txtPassword', PASSWORD!);
    await page.click('#btnLogin');

    console.log('   Waiting for redirect after login...');
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 30000 });
    await page.waitForTimeout(2000);

    const rawCookies = await context.cookies();
    const cookieMap: Record<string, string> = {};
    for (const cookie of rawCookies) {
        if (WANTED_COOKIES.includes(cookie.name)) {
            cookieMap[cookie.name] = cookie.value;
        }
    }
    if (cookieMap['ASP.NET_SessionId'] && !cookieMap['usrtkn']) {
        cookieMap['usrtkn'] = `tkn=${cookieMap['ASP.NET_SessionId']}`;
    }

    await browser.close();

    const foundKeys = Object.keys(cookieMap);
    if (foundKeys.length === 0) {
        console.error('❌ No cookies extracted. Login may have failed.');
        process.exit(1);
    }
    console.log(`   Extracted cookies: ${foundKeys.join(', ')}`);

    if (!cookieMap['cf_clearance']) {
        console.warn('⚠️  cf_clearance not found — Cloudflare bypass in production may not work.');
    }

    console.log('💾 Saving cookies to Supabase...');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
    const { error } = await supabase.from('auth_cookies').upsert({
        id: 1,
        cookie_json: cookieMap,
        updated_at: new Date().toISOString(),
    });

    if (error) {
        console.error('❌ Failed to save cookies to Supabase:', error.message);
        process.exit(1);
    }

    console.log('✅ Cookies saved! Your Netlify app can now log in and fetch data.');
    console.log('   Re-run this script if login stops working (cf_clearance expires in a few days).');
}

main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
