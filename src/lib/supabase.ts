import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file')
}

// Create a storage wrapper that fixes broken token expiry timestamps from Supabase
const customStorage = {
  getItem: (key: string) => {
    try {
      return window.localStorage.getItem(key)
    } catch (error) {
      console.error('localStorage getItem error:', error)
      return null
    }
  },
  setItem: (key: string, value: string) => {
    try {
      // CRITICAL FIX: Supabase is issuing tokens with invalid expiry timestamps
      // that are already expired or expire in <1 second. Fix them here.
      if (key.includes('auth') && value) {
        try {
          const session = JSON.parse(value)
          if (session.expires_at) {
            const now = Math.floor(Date.now() / 1000)
            const expiresAt = session.expires_at
            const timeUntilExpiry = expiresAt - now
            
            // If token expires in less than 5 minutes, it's broken - fix it
            if (timeUntilExpiry < 300) {
              // Fix: Extend expiry to 1 hour from NOW
              session.expires_at = now + 3600
              session.expires_in = 3600
              value = JSON.stringify(session)
            }
          }
        } catch (e) {
          // Not JSON or not a session, save as-is
        }
      }
      
      window.localStorage.setItem(key, value)
    } catch (error) {
      console.error('localStorage setItem error:', error)
    }
  },
  removeItem: (key: string) => {
    try {
      window.localStorage.removeItem(key)
    } catch (error) {
      console.error('localStorage removeItem error:', error)
    }
  },
}

// Filter out GoTrueClient session logs from console
const originalConsoleLog = console.log
console.log = (...args: any[]) => {
  // Check all arguments for the GoTrueClient session log pattern
  const message = args.map(arg => String(arg)).join(' ')
  // Filter out GoTrueClient session storage logs
  if (message.includes('GoTrueClient') && (message.includes('#getSession() session from storage') || message.includes('session from storage'))) {
    return // Don't log this message
  }
  originalConsoleLog.apply(console, args)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // DISABLE auto-refresh completely to stop the rapid-fire loop
    // We'll handle refresh manually when needed
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'health-billing-auth',
    storage: customStorage,
    debug: false, // Disable debug logging to prevent GoTrueClient session logs
  },
  global: {
    headers: {
      'X-Client-Info': 'health-billing-app',
    },
  },
})

/** Creates a separate Supabase client with its own auth storage key so the current session is not replaced (e.g. for signUp or password verification). */
export function createSupabaseClientWithStorageKey(storageKey: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      storageKey,
      storage: customStorage,
    },
    global: {
      headers: {
        'X-Client-Info': 'health-billing-app',
      },
    },
  })
}

/** Creates a separate Supabase client with its own auth storage. Use when creating a new user via signUp so the current session is not replaced. */
export function createSupabaseClientForSignUp() {
  return createSupabaseClientWithStorageKey('health-billing-auth-create-user')
}

// Manual refresh handler - only refresh when absolutely necessary
let manualRefreshInProgress = false
let lastManualRefresh = 0

export async function ensureValidSession() {
  const now = Date.now()
  
  // Throttle: Don't refresh more than once per 30 seconds
  if (now - lastManualRefresh < 30000) {
    return
  }
  
  // Don't start a new refresh if one is in progress
  if (manualRefreshInProgress) {
    return
  }
  
  try {
    manualRefreshInProgress = true
    const { error } = await supabase.auth.refreshSession()
    
    if (!error) {
      lastManualRefresh = now
    } else {
      console.error('Manual session refresh failed:', error)
    }
  } catch (error) {
    console.error('Manual session refresh error:', error)
  } finally {
    manualRefreshInProgress = false
  }
}
