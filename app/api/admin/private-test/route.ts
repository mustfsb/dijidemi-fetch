import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { supabase as supabaseServiceRole } from '@/lib/db/supabase';

type AdminAuthResult =
    | { user: any }
    | { error: string; status: number };

async function verifyAdmin(): Promise<AdminAuthResult> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        return { error: 'Server configuration error', status: 500 };
    }

    const supabaseSSR = await createAdminClient();
    const { data: { user }, error: authError } = await supabaseSSR.auth.getUser();
    if (authError || !user) {
        return { error: 'Unauthorized', status: 401 };
    }

    let isAdmin = false;
    const username = user.user_metadata?.username;
    if (username) {
        const { data: adminRef } = await supabaseServiceRole
            .from('admin')
            .select('role')
            .eq('username', username)
            .single();
        if (adminRef?.role === 'admin') isAdmin = true;
    }

    if (!isAdmin) {
        return { error: 'Forbidden', status: 403 };
    }

    return { user };
}

async function ensureControlRow() {
    await supabaseServiceRole
        .from('private_test_enrollment_control')
        .upsert(
            {
                id: 1,
                is_open: false,
                enrollment_until: null,
                updated_by: 'system',
            },
            { onConflict: 'id', ignoreDuplicates: true }
        );
}

export async function GET() {
    try {
        const auth = await verifyAdmin();
        if ('error' in auth) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }

        await ensureControlRow();

        const { data: settings, error: settingsError } = await supabaseServiceRole
            .from('private_test_enrollment_control')
            .select('is_open, enrollment_until, updated_at, updated_by')
            .eq('id', 1)
            .single();

        if (settingsError) throw settingsError;

        const { data: bindings, error: bindingsError } = await supabaseServiceRole
            .from('private_test_device_bindings')
            .select('id, user_id, browser_name, browser_major, user_agent, created_at, last_seen_at, revoked_at, users(username, external_id, full_name)')
            .is('revoked_at', null)
            .order('created_at', { ascending: false });

        if (bindingsError) throw bindingsError;

        return NextResponse.json({
            settings,
            bindings: bindings || [],
        });
    } catch (error) {
        console.error('[Admin PrivateTest GET] Failed:', error);
        return NextResponse.json(
            { error: 'Failed to fetch private-test settings' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const auth = await verifyAdmin();
        if ('error' in auth) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }

        const body = await request.json();
        const action = body?.action as string | undefined;

        if (action === 'update_binding') {
            const bindingId = Number.parseInt(String(body?.binding_id), 10);
            if (!Number.isFinite(bindingId) || bindingId <= 0) {
                return NextResponse.json({ error: 'Invalid binding_id' }, { status: 400 });
            }

            const updates: Record<string, unknown> = {};
            if (typeof body?.user_id === 'string' && body.user_id.trim()) {
                updates.user_id = body.user_id.trim();
            }
            if (typeof body?.browser_name === 'string' && body.browser_name.trim()) {
                updates.browser_name = body.browser_name.trim();
            }
            if (typeof body?.browser_major === 'number' && Number.isFinite(body.browser_major) && body.browser_major >= 0) {
                updates.browser_major = Math.floor(body.browser_major);
            }
            if (body?.user_agent === null || typeof body?.user_agent === 'string') {
                updates.user_agent = body.user_agent;
            }

            if (Object.keys(updates).length === 0) {
                return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
            }

            const { data: updatedBinding, error: updateError } = await supabaseServiceRole
                .from('private_test_device_bindings')
                .update(updates)
                .eq('id', bindingId)
                .select('id, user_id, browser_name, browser_major, user_agent, created_at, last_seen_at, revoked_at')
                .single();

            if (updateError) throw updateError;
            return NextResponse.json({ success: true, binding: updatedBinding });
        }

        if (action === 'revoke_binding') {
            const bindingId = Number.parseInt(String(body?.binding_id), 10);
            if (!Number.isFinite(bindingId) || bindingId <= 0) {
                return NextResponse.json({ error: 'Invalid binding_id' }, { status: 400 });
            }

            const { error: revokeError } = await supabaseServiceRole
                .from('private_test_device_bindings')
                .update({ revoked_at: new Date().toISOString() })
                .eq('id', bindingId)
                .is('revoked_at', null);

            if (revokeError) throw revokeError;
            return NextResponse.json({ success: true });
        }

        const isOpen = Boolean(body?.is_open);
        const rawDurationHours = body?.duration_hours;
        const durationHours =
            typeof rawDurationHours === 'number' && Number.isFinite(rawDurationHours)
                ? Math.max(0, rawDurationHours)
                : null;

        const enrollmentUntil = isOpen && durationHours && durationHours > 0
            ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()
            : null;

        const updatedBy = auth.user?.user_metadata?.username
            || auth.user?.email
            || 'unknown-admin';

        const { data, error } = await supabaseServiceRole
            .from('private_test_enrollment_control')
            .upsert(
                {
                    id: 1,
                    is_open: isOpen,
                    enrollment_until: enrollmentUntil,
                    updated_by: updatedBy,
                },
                { onConflict: 'id' }
            )
            .select('is_open, enrollment_until, updated_at, updated_by')
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, settings: data });
    } catch (error) {
        console.error('[Admin PrivateTest PATCH] Failed:', error);
        return NextResponse.json(
            { error: 'Failed to update private-test enrollment' },
            { status: 500 }
        );
    }
}
