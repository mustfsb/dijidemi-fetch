import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testLogin() {
  const username = process.env.ADMIN_TEST_USERNAME?.trim();
  const password = process.env.ADMIN_TEST_PASSWORD?.trim();

  if (!username || !password) {
    console.error('Set ADMIN_TEST_USERNAME and ADMIN_TEST_PASSWORD in environment before running this script.');
    process.exit(1);
  }

  console.log(`Testing login for: ${username}`);

  const { data, error } = await supabase
    .from('admin')
    .select('username, role, password')
    .eq('username', username)
    .maybeSingle();

  if (error || !data) {
    console.error('Login failed:', error.message);
    return;
  }

  const storedPassword = typeof data.password === 'string' ? data.password.trim() : '';
  if (!storedPassword) {
    console.error('Login failed: admin record has no password configured.');
    return;
  }

  const isHashed = storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$');
  const passwordValid = isHashed
    ? await bcrypt.compare(password, storedPassword)
    : storedPassword === password;

  if (!passwordValid) {
    console.error('Login failed: password mismatch.');
    return;
  }

  console.log('Login success! Record:', {
    username: data.username,
    role: data.role,
    hasPassword: true,
    hashed: isHashed,
  });
}

testLogin();
