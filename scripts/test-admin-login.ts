import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testLogin() {
  const username = '14308-1651';
  const password = '175F7';

  console.log(`Testing login for: ${username}`);

  const { data, error } = await supabase
    .from('admin')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .single();

  if (error) {
    console.error('Login failed:', error.message);
  } else {
    console.log('Login success! Record:', data);
  }
}

testLogin();
