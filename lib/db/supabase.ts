import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Prioritize Service Role Key for backend operations (bypasses RLS)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Ensure we have the keys before creating the client to avoid runtime errors
if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase credentials are missing. Cookie persistence will not work.');
}

// Use placeholders to prevent build crash if env vars are missing
const url = supabaseUrl || 'https://placeholder.supabase.co';
const key = supabaseKey || 'placeholder';

export const supabase = createClient(url, key, {
    auth: {
        persistSession: false, // Service Role doesn't need session persistence
        autoRefreshToken: false,
    }
});
