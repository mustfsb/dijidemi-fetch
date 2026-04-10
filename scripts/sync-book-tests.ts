#!/usr/bin/env tsx
/**
 * Local book-tests sync — run this on your own machine to populate the
 * Supabase cache so the Netlify app can serve book tests without
 * contacting dijidemi.com (which is blocked on Lambda by Cloudflare).
 *
 * Usage:
 *   npm run sync-books
 *
 * Requirements:
 *   .env.local must contain:
 *     NEXT_PUBLIC_SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY
 *     DIJIDEMI_USERNAME
 *     DIJIDEMI_PASSWORD
 *
 * The script opens a real (non-headless) Chrome window, logs in to
 * dijidemi.com, then fetches tests for all 56 books via page.evaluate(fetch())
 * and stores them in the Supabase book_tests_cache table.
 *
 * Run after `npm run seed-cookies` if you haven't already.
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import booksData from '../app/data/books.json';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USERNAME = process.env.DIJIDEMI_USERNAME;
const PASSWORD = process.env.DIJIDEMI_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}
if (!USERNAME || !PASSWORD) {
    console.error('Missing: DIJIDEMI_USERNAME and/or DIJIDEMI_PASSWORD in .env.local');
    process.exit(1);
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

interface Book { name: string; id: string; }
interface Test { name: string; id: string; }

function parseTests(html: string): Test[] {
    const tests: Test[] = [];
    const regex = /<h3>(.*?)<\/h3>[\s\S]*?data-rowid="(\d+)"/g;
    for (const match of html.matchAll(regex)) {
        const name = match[1].trim().replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
        tests.push({ name, id: match[2] });
    }
    return tests;
}

async function main() {
    const books = booksData as Book[];
    console.log(`Starting sync for ${books.length} books...`);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

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

    // Log in
    console.log('Navigating to dijidemi.com/login...');
    await page.goto('https://www.dijidemi.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#txtUserName', { state: 'visible', timeout: 60000 });
    await page.fill('#txtUserName', USERNAME!);
    await page.fill('#txtPassword', PASSWORD!);
    await page.click('#btnLogin');
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 30000 });
    await page.waitForTimeout(1500);
    console.log('Logged in. Starting book sync...\n');

    let success = 0;
    let failed = 0;

    for (const book of books) {
        try {
            const html = await page.evaluate(async ({ bookId }) => {
                const url = `https://www.dijidemi.com/Ogrenci/KitapTestlerTable?Id=${bookId}&___layout=`;
                const res = await fetch(url, {
                    method: 'POST',
                    body: '',
                    credentials: 'include',
                    redirect: 'follow',
                    referrer: 'https://www.dijidemi.com/Ogrenci',
                    referrerPolicy: 'strict-origin-when-cross-origin',
                });
                return res.text();
            }, { bookId: book.id });

            const tests = parseTests(html);

            const { error } = await supabase.from('book_tests_cache').upsert({
                book_id: book.id,
                tests,
                updated_at: new Date().toISOString(),
            });

            if (error) {
                console.error(`  [${book.id}] DB error: ${error.message}`);
                failed++;
            } else {
                console.log(`  [${book.id}] ${book.name.slice(0, 40)} — ${tests.length} tests`);
                success++;
            }
        } catch (err) {
            console.error(`  [${book.id}] FAILED: ${err instanceof Error ? err.message : err}`);
            failed++;
        }

        // Small delay to avoid hammering the server
        await page.waitForTimeout(300);
    }

    await browser.close();

    console.log(`\nDone. ${success} books synced, ${failed} failed.`);
    if (failed > 0) {
        console.log('Re-run to retry failed books.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
