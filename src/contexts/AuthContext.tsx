import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { User as SupabaseUser, Session } from '@supabase/supabase-js'
import { supabase, ensureValidSession } from '@/lib/supabase'
import { User } from '@/types'

interface AuthContextType {
  user: SupabaseUser | null
  userProfile: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userProfile, setUserProfile] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const lastTokenRefreshRef = useRef<number>(0)
  const tokenRefreshCountRef = useRef<number>(0)
  const refreshInProgressRef = useRef<boolean>(false)

  useEffect(() => {
    // Get initial session and check if refresh is needed
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Check if token is expired or about to expire (< 5 minutes left)
        const expiresAt = session.expires_at || 0
        const now = Math.floor(Date.now() / 1000)
        const timeUntilExpiry = expiresAt - now
        
        if (timeUntilExpiry < 300) {
          // Refresh the session immediately
          await ensureValidSession()
          // Get the refreshed session
          const { data: { session: refreshedSession } } = await supabase.auth.getSession()
          setSession(refreshedSession)
          setUser(refreshedSession?.user ?? null)
          if (refreshedSession?.user) {
            fetchUserProfile(refreshedSession.user.id)
          }
        } else {
          setSession(session)
          setUser(session?.user ?? null)
          if (session?.user) {
            fetchUserProfile(session.user.id)
          }
        }
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Track token refresh frequency
      if (event === 'TOKEN_REFRESHED') {
        const now = Date.now()
        const timeSinceLastRefresh = now - lastTokenRefreshRef.current
        tokenRefreshCountRef.current += 1
        
        // AGGRESSIVE THROTTLE: Only allow ONE refresh per 30 seconds minimum
        // This prevents the rapid-fire refresh loop
        if (lastTokenRefreshRef.current > 0 && timeSinceLastRefresh < 30000) {
          // SILENTLY IGNORE rapid refreshes
          return
        }
        
        lastTokenRefreshRef.current = now
        refreshInProgressRef.current = false
        
        // Token refreshed - no state updates needed
        // The token is automatically updated in Supabase client
        return
      }
      
      setSession(session)
      setUser(session?.user ?? null)
      
      // Only fetch user profile for meaningful auth events
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
        fetchUserProfile(session.user.id)
      } else if (!session) {
        setUserProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Manual token refresh every 45 minutes (instead of relying on autoRefreshToken)
  useEffect(() => {
    if (!user) return
    
    // Refresh session every 45 minutes (well before 1-hour expiry)
    const refreshInterval = setInterval(async () => {
      await ensureValidSession()
    }, 45 * 60 * 1000) // 45 minutes

    return () => {
      clearInterval(refreshInterval)
    }
  }, [user])

  const fetchUserProfile = async (userId: string) => {
    // Skip if we already have the profile for this user
    if (userProfile && userProfile.id === userId) {
      setLoading(false)
      return
    }
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error && error.code !== 'PGRST116') {
        throw error
      }
      if (data && data.active === false) {
        try {
          await supabase.auth.signOut()
        } catch {
          // ignore
        }
        setUserProfile(null)
        setSession(null)
        setUser(null)
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('login_deactivated', '1')
        }
      } else {
        setUserProfile(data || null)
      }
    } catch (error) {
      console.error('Error fetching user profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const signIn = async (email: string, password: string) => {
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    if (authData?.user?.id) {
      const { data: profile } = await supabase
        .from('users')
        .select('active')
        .eq('id', authData.user.id)
        .maybeSingle()
      if (profile && profile.active === false) {
        await supabase.auth.signOut()
        throw new Error('Your account has been deactivated. Please contact your administrator.')
      }
    }
  }

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (err) {
      // Session may already be missing/expired (403, AuthSessionMissingError). Still clear local state
      // so the UI shows logged out and the user can sign in again.
      setSession(null)
      setUser(null)
      setUserProfile(null)
      setLoading(false)
    }
  }

  const signUp = async (email: string, password: string, fullName: string, role: string) => {
    const { data: authData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role, // Stored in metadata for handle_new_user trigger
        },
      },
    })
    if (error) throw error
    
    // Auto-confirm email via database function (backup if trigger doesn't work)
    if (authData.user) {
      try {
        await supabase.rpc('auto_confirm_user_email', { user_id: authData.user.id })
      } catch (confirmError) {
        // Ignore errors - trigger should handle it, or user can confirm via email
        console.warn('Could not auto-confirm email:', confirmError)
      }
    }
    // User profile is created automatically by the handle_new_user trigger on auth.users
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        session,
        loading,
        signIn,
        signOut,
        signUp,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
