import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getClientIp } from '@/lib/auth'
import { RateLimits } from '@/lib/rate-limit'

function log(msg: string) {
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
  }
}

export async function POST(request: NextRequest) {
  // Rate limit login attempts
  const ip = getClientIp(request);
  if (!RateLimits.LOGIN(ip)) {
    return NextResponse.json({ error: 'Çok fazla giriş denemesi. Lütfen bekleyin.' }, { status: 429 });
  }

  const { username, password } = await request.json()
  const cookieStore = cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  log(`Login attempt received for admin user`);

  // 1. Direct Client for DB Check (More robust than SSR client for service tasks)
  const supabaseDirect = createClient(url, serviceKey);

  try {
    const trimmedUsername = username?.trim();
    const trimmedPassword = password?.trim();

    if (!trimmedUsername || !trimmedPassword) {
      return NextResponse.json({ error: 'Kullanıcı adı ve şifre gerekli.' }, { status: 400 });
    }

    // 2. Validate Credentials against the 'admin' table
    //    Step A: Query for username WITH role='admin' (DB-level filter)
    const { data: adminRecord, error: adminError } = await supabaseDirect
      .from('admin')
      .select('username, role, password')
      .eq('username', trimmedUsername)
      .eq('role', 'admin')
      .single();

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
          log(`[Auth] DENIED: user exists but role is not admin`);
          // Downgrade the mirrored auth user's app_metadata so stale sessions are invalidated
          const internalEmail = `${trimmedUsername}@internal.admin`;
          const { data: { users: allUsers } } = await supabaseDirect.auth.admin.listUsers();
          const staleUser = allUsers?.find((u: any) => u.email === internalEmail);
          if (staleUser) {
            await supabaseDirect.auth.admin.updateUserById(staleUser.id, {
              app_metadata: { role: 'user' }
            });
          }
          return NextResponse.json({ error: 'Admin yetkiniz kaldırılmış.' }, { status: 403 });
        }

        return NextResponse.json({ error: 'Hatalı kullanıcı adı veya şifre.' }, { status: 401 });
      }
      log(`[Auth] Database error during admin lookup`);
      return NextResponse.json({ error: 'Veritabanı hatası. Lütfen tekrar deneyin.' }, { status: 500 });
    }

    //    Step B: If admin has a non-empty password, verify it matches using bcrypt
    if (adminRecord.password && adminRecord.password.trim() !== '') {
      // Support both bcrypt hashed and legacy plaintext passwords
      const isHashed = adminRecord.password.startsWith('$2a$') || adminRecord.password.startsWith('$2b$');
      
      let passwordValid = false;
      if (isHashed) {
        passwordValid = await bcrypt.compare(trimmedPassword, adminRecord.password);
      } else {
        // Legacy plaintext comparison - migrate to hash after successful login
        passwordValid = adminRecord.password === trimmedPassword;
        
        if (passwordValid) {
          // Auto-migrate: hash the plaintext password and update in DB
          const hashedPassword = await bcrypt.hash(trimmedPassword, 12);
          await supabaseDirect
            .from('admin')
            .update({ password: hashedPassword })
            .eq('username', trimmedUsername);
          log(`[Auth] Migrated plaintext password to bcrypt hash for admin user`);
        }
      }

      if (!passwordValid) {
        log(`[Auth] Password mismatch for admin user`);
        return NextResponse.json({ error: 'Hatalı kullanıcı adı veya şifre.' }, { status: 401 });
      }
    }

    log(`[Auth] Admin credentials verified successfully`);

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
        log(`[Auth] Creating mirrored admin auth user`);
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: internalEmail,
            password: trimmedPassword, 
            email_confirm: true,
            user_metadata: { is_mirrored_admin: true, username: trimmedUsername },
            app_metadata: { role: adminRecord.role }
        });

        if (createError) {
            log(`[Auth] Mirror user creation failed`);
            throw createError;
        }
        authUser = newUser.user;
    } else {
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
      log(`[Auth] SignInWithPassword failed for mirrored user`);
      throw signInError;
    }

    if (signInData.user) {
        // Final sanity sync
        const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
            id: signInData.user.id,
            username: trimmedUsername,
            role: adminRecord.role,
            updated_at: new Date().toISOString()
        });
        if (profileError) log(`[Auth] Final profile sync error`);
    }

    log(`[Auth] Login successful`);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Admin Login error:', err)
    return NextResponse.json({ error: 'Beklenmedik bir hata oluştu.' }, { status: 500 })
  }
}
