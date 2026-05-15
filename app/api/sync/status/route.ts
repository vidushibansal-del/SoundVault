import { serviceClient } from '@/lib/supabase'

export async function GET() {
  const { data } = await serviceClient
    .from('sync_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()
  return Response.json(data)
}
