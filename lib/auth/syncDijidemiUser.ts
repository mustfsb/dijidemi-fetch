import { NextRequest } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getClientIp } from '@/lib/auth';

/**
 * Sync Dijidemi user identity into the local app user table and log the login event.
 * Returns the UUID of the user row on success.
 */
export async function syncDijidemiUserToDatabase(
    username: string,
    request: NextRequest
): Promise<string | undefined> {
    try {
        const ip = getClientIp(request);

        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('external_id', username)
            .single();

        let userId: string;

        if (existingUser) {
            userId = existingUser.id;
            await supabase
                .from('users')
                .update({
                    last_login_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', userId);

            console.log(`[Auth] Existing user logged in: ${username} (${userId})`);
        } else {
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{
                    external_id: username,
                    username,
                    role: 'user',
                    last_login_at: new Date().toISOString(),
                }])
                .select('id')
                .single();

            if (insertError || !newUser) {
                console.error('[Auth] Failed to create user record:', insertError);
                return undefined;
            }

            userId = newUser.id;
            console.log(`[Auth] New user created: ${username} (${userId})`);
        }

        await supabase.from('logs').insert([{
            user_id: userId,
            event_type: 'LOGIN',
            ip_address: ip,
            details: { source: 'dijidemi' },
        }]);

        return userId;
    } catch (error) {
        console.error('[Auth] User sync error:', error);
        return undefined;
    }
}
