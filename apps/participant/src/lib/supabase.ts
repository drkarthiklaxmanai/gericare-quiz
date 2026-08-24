import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://ugvyrcmfksyddrbelagi.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NyBCdEnEKKiM_ZKFfcR7eQ_xejNGqkR'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(url, anonKey)
