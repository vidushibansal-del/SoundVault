import { serviceClient } from '@/lib/supabase'

export async function GET() {
  const { data } = await serviceClient.from('sounds').select('category').order('category')
  const unique = [...new Set((data ?? []).map(r => r.category))]
  return Response.json(unique)
}
