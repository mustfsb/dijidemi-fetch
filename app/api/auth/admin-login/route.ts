import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
function log(msg: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

export async function POST(request: Request) {
  const { username, password } = await request.json()
  const cookieStore = cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  log(`Login attempt received: username=[${username}]`);

  // 1. Direct Client for DB Check (More robust than SSR client for service tasks)
  const supabaseDirect = createClient(url, serviceKey);

  try {
    const trimmedUsername = username?.trim();
    const trimmedPassword = password?.trim();

    // 2. Validate Credentials against the 'admin' table
    //    Step A: Query for username WITH role='admin' (DB-level filter)
    log(`[DEBUG] Querying admin table for username='${trimmedUsername}' AND role='admin'`);
    log(`[DEBUG] Using Supabase URL: ${url?.substring(0, 30)}...`);
    log(`[DEBUG] Service key present: ${!!serviceKey}`);

    const { data: adminRecord, error: adminError } = await supabaseDirect
      .from('admin')
      .select('*')
      .eq('username', trimmedUsername)
      .eq('role', 'admin')
      .single();

    log(`[DEBUG] Query result — data: ${JSON.stringify(adminRecord)}, error: ${JSON.stringify(adminError)}`);

    if (adminError || !adminRecord) {
      // Determine the exact reason for denial
      if (adminError?.code === 'PGRST116') {
        // Row not found — could be non-existent or role != 'admin'
        // Check if the user exists but with a different role
        const { data: anyRecord } = await supabaseDirect
          .from('admin')
          .select('role')
          .eq('username', trimmedUsername)
          .single();

        if (anyRecord) {
          log(`[Auth] DENIED: '${trimmedUsername}' exists in admin table but role='${anyRecord.role}', not 'admin'`);
          // Downgrade the mirrored auth user's app_metadata so stale sessions are invalidated
          const internalEmail = `${trimmedUsername}@internal.admin`;
          const { data: { users: allUsers } } = await supabaseDirect.auth.admin.listUsers();
          const staleUser = allUsers?.find((u: any) => u.email === internalEmail);
          if (staleUser) {
            await supabaseDirect.auth.admin.updateUserById(staleUser.id, {
              app_metadata: { role: 'user' }
            });
            log(`[Auth] Downgraded mirrored auth user '${internalEmail}' app_metadata.role to 'user'`);
          }
          return NextResponse.json({ error: 'Admin yetkiniz kaldırılmış.' }, { status: 403 });
        }

        log(`[Auth] No record at all for username='${trimmedUsername}'`);
        return NextResponse.json({ error: 'Bu kullanıcı admin olarak kayıtlı değil.' }, { status: 401 });
      }
      log(`[Auth] Database error during admin lookup: ${adminError?.message} (code: ${adminError?.code})`);
      return NextResponse.json({ error: 'Veritabanı hatası. Lütfen tekrar deneyin.' }, { status: 500 });
    }

    //    Step B: If admin has a non-empty password, verify it matches
    if (adminRecord.password && adminRecord.password.trim() !== '') {
      if (adminRecord.password !== trimmedPassword) {
        log(`Password mismatch for admin: ${trimmedUsername}`);
        return NextResponse.json({ error: 'Hatalı kullanıcı adı veya şifre.' }, { status: 401 });
      }
    }

    log(`Admin table check success for: ${adminRecord.username}`);

    // 3. User is valid. Ensure a Supabase Auth session exists for the middleware
    const internalEmail = `${trimmedUsername}@internal.admin`;
    
    // Setup Admin client for mirroring
    const supabaseAdmin = createServerClient(url, serviceKey, {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value },
          set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }) },
          remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }) },
        },
    })

    // Check if auth user exists, if not create (one-time setup for this admin)
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    let authUser = users.find((u: any) => u.email === internalEmail);

    if (!authUser) {
        log(`Creating mirrored admin user: ${internalEmail}`);
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: internalEmail,
            password: trimmedPassword, 
            email_confirm: true,
            user_metadata: { is_mirrored_admin: true, username: trimmedUsername },
            app_metadata: { role: adminRecord.role }
        });

        if (createError) {
            log(`Mirror user creation failed: ${createError.message}`);
            throw createError;
        }
        authUser = newUser.user;
    } else {
        log(`Updating existing mirrored admin user: ${authUser.id}`);
        await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
            app_metadata: { role: adminRecord.role },
            user_metadata: { is_mirrored_admin: true, username: trimmedUsername }
        });
    }

    // 4. Sign in to Supabase to get a valid Cookie session
    const authClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get(name: string) { return cookieStore.get(name)?.value },
            set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }) },
            remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }) },
          },
        }
      )

    const { error: signInError, data: signInData } = await authClient.auth.signInWithPassword({
      email: internalEmail,
      password: trimmedPassword,
    });

    if (signInError) {
      log(`SignInWithPassword failed for mirrored user: ${signInError.message}`);
      throw signInError;
    }

    if (signInData.user) {
        log(`Session established. User ID: ${signInData.user.id}, App Metadata Role: ${signInData.user.app_metadata?.role}`);
        
        // Final sanity sync
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: signInData.user.id,
            username: trimmedUsername,
            role: adminRecord.role,
            updated_at: new Date().toISOString()
        });
        if (profileError) log(`Final profile sync error: ${profileError.message}`);
    }

    log(`Login successful for: ${trimmedUsername}`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Admin Login error:', err)
    return NextResponse.json({ error: 'Beklenmedik bir hata oluştu.' }, { status: 500 })
  }
}
