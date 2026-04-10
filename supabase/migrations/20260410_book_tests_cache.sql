-- Book tests cache table
-- Populated locally via: npm run sync-books
-- Read by /api/book-tests when live dijidemi.com fetch fails (Lambda is blocked by Cloudflare)

CREATE TABLE IF NOT EXISTS public.book_tests_cache (
    book_id  TEXT        PRIMARY KEY,
    tests    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.book_tests_cache ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (used by server-side API routes)
CREATE POLICY "service_role_all" ON public.book_tests_cache
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
