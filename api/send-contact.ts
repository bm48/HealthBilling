const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const EDGE_FUNCTION_SLUG = 'smooth-endpoint'

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { setHeader: (n: string, v: string) => void; status: (c: number) => { end: () => void; json: (b: unknown) => void; send: (b: string) => void } }
) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(500).json({ error: 'Server configuration missing' })
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${EDGE_FUNCTION_SLUG}`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(req.body || {}),
    })
    const text = await response.text()
    res.setHeader('Access-Control-Allow-Origin', '*')
    const status = response.status
    try {
      res.status(status).json(text ? JSON.parse(text) : {})
    } catch {
      res.status(status).send(text)
    }
  } catch {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(500).json({ error: 'Failed to send message' })
  }
}
