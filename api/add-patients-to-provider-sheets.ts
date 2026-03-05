/**
 * Vercel serverless proxy to Supabase Edge Function add-patients-to-provider-sheets.
 * Forwards the request with the user's Authorization (JWT) and body so the Edge Function
 * runs in Supabase while the app can call same-origin /api/add-patients-to-provider-sheets on Vercel.
 */

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
const EDGE_FUNCTION_SLUG = 'add-patients-to-provider-sheets'

export default async function handler(
  req: { method?: string; headers?: { authorization?: string }; body?: unknown },
  res: {
    setHeader: (name: string, value: string) => void
    status: (code: number) => { end: () => void; json: (body: unknown) => void; send: (body: string) => void }
  }
) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!SUPABASE_URL) {
    return res.status(500).json({ error: 'Server not configured (missing SUPABASE_URL)' })
  }

  const authHeader = req.headers?.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = `${SUPABASE_URL}/functions/v1/${EDGE_FUNCTION_SLUG}`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(req.body ?? {}),
    })
    const text = await response.text()
    const status = response.status
    try {
      return res.status(status).json(text ? JSON.parse(text) : {})
    } catch {
      return res.status(status).send(text)
    }
  } catch (err) {
    console.error('add-patients-to-provider-sheets proxy error:', err)
    return res.status(500).json({ error: 'Failed to add patients to provider sheets' })
  }
}
