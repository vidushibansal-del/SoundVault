import { NextRequest } from 'next/server'
import { anonClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const category = searchParams.get('category') ?? ''
  const limit = parseInt(searchParams.get('limit') ?? '30')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  let query = anonClient.from('sounds').select('*', { count: 'exact' })

  if (q.trim()) {
    query = query.textSearch('search_vector', q.trim(), { type: 'websearch' })
  } else {
    query = query.order('modified_in_drive', { ascending: false })
  }

  if (category) query = query.ilike('category', category)

  query = query.range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ results: data, total: count, offset, limit })
}
