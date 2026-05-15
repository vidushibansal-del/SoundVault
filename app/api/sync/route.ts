import { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase'
import { parseTags } from '@/lib/parseTags'

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.aiff', '.flac', '.ogg'])

function getExtension(name: string): string {
  const m = name.match(/\.[^.]+$/)
  return m ? m[0].toLowerCase() : ''
}

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to get access token')
  return data.access_token
}

async function listDriveFiles(accessToken: string): Promise<any[]> {
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  const fields = 'nextPageToken,files(id,name,parents,mimeType,size,modifiedTime,webViewLink,webContentLink)'
  const files: any[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      q: `'${rootId}' in parents and trashed=false`,
      fields,
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json()
    if (data.files) files.push(...data.files)
    pageToken = data.nextPageToken
  } while (pageToken)

  return files
}

async function getFolderName(accessToken: string, folderId: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await res.json()
  return data.name ?? 'Uncategorized'
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { data: logRow } = await serviceClient
    .from('sync_log')
    .insert({ status: 'running' })
    .select('id')
    .single()
  const logId = logRow?.id

  try {
    const accessToken = await getAccessToken()
    const allFiles = await listDriveFiles(accessToken)

    const audioFiles = allFiles.filter(
      f => f.mimeType !== 'application/vnd.google-apps.folder' && AUDIO_EXTENSIONS.has(getExtension(f.name))
    )

    const folderIds = [...new Set(audioFiles.flatMap(f => f.parents ?? []))]
    const folderNameMap = new Map<string, string>()
    await Promise.all(
      folderIds.map(async id => {
        folderNameMap.set(id, await getFolderName(accessToken, id))
      })
    )

    const rows = audioFiles.map(f => {
      const { nameClean, tags } = parseTags(f.name)
      const ext = getExtension(f.name)
      return {
        drive_id: f.id,
        name: f.name,
        name_clean: nameClean,
        category: folderNameMap.get(f.parents?.[0]) ?? 'Uncategorized',
        tags,
        extension: ext,
        web_view_link: f.webViewLink,
        download_link: `https://drive.google.com/uc?export=download&id=${f.id}`,
        file_size: f.size ? parseInt(f.size) : null,
        modified_in_drive: f.modifiedTime ?? null,
      }
    })

    let filesUpserted = 0
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error } = await serviceClient.from('sounds').upsert(batch, { onConflict: 'drive_id' })
      if (error) throw new Error(error.message)
      filesUpserted += batch.length
    }

    const fetchedIds = audioFiles.map(f => f.id)
    const { data: deleted } = await serviceClient
      .from('sounds')
      .delete()
      .not('drive_id', 'in', `(${fetchedIds.map(id => `'${id}'`).join(',')})`)
      .select('id')
    const filesDeleted = deleted?.length ?? 0

    await serviceClient
      .from('sync_log')
      .update({ status: 'success', files_upserted: filesUpserted, files_deleted: filesDeleted, finished_at: new Date().toISOString() })
      .eq('id', logId)

    return Response.json({ status: 'success', files_upserted: filesUpserted, files_deleted: filesDeleted })
  } catch (err: any) {
    await serviceClient
      .from('sync_log')
      .update({ status: 'error', error: err.message, finished_at: new Date().toISOString() })
      .eq('id', logId)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
