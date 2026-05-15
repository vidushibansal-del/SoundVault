import { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase'
import { parseTags } from '@/lib/parseTags'

type IngestFile = {
  id: string
  name: string
  category: string
  webViewLink: string
  size: number | null
  modifiedTime: string | null
  uploadedBy: string | null
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.INGEST_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: logRow } = await serviceClient
    .from('sync_log')
    .insert({ status: 'running' })
    .select('id')
    .single()
  const logId = logRow?.id

  try {
    const { files }: { files: IngestFile[] } = await req.json()

    const rows = files.map(f => {
      const ext = f.name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? ''
      const { nameClean, tags } = parseTags(f.name)
      return {
        drive_id: f.id,
        name: f.name,
        name_clean: nameClean,
        category: f.category,
        tags,
        extension: ext,
        web_view_link: f.webViewLink,
        download_link: `https://drive.google.com/uc?export=download&id=${f.id}`,
        file_size: f.size ?? null,
        modified_in_drive: f.modifiedTime ?? null,
        uploaded_by: f.uploadedBy ?? null,
      }
    })

    let filesUpserted = 0
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error } = await serviceClient.from('sounds').upsert(batch, { onConflict: 'drive_id' })
      if (error) throw new Error(error.message)
      filesUpserted += batch.length
    }

    await serviceClient
      .from('sync_log')
      .update({ status: 'success', files_upserted: filesUpserted, finished_at: new Date().toISOString() })
      .eq('id', logId)

    return Response.json({ status: 'success', files_upserted: filesUpserted })
  } catch (err: any) {
    await serviceClient
      .from('sync_log')
      .update({ status: 'error', error: err.message, finished_at: new Date().toISOString() })
      .eq('id', logId)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
