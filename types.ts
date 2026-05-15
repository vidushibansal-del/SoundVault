export type Sound = {
  id: string
  drive_id: string
  name: string
  name_clean: string
  category: string
  tags: string[]
  extension: string
  web_view_link: string
  download_link: string
  file_size: number | null
  modified_in_drive: string | null
}

export type SyncStatus = {
  started_at: string
  finished_at: string | null
  files_upserted: number
  files_deleted: number
  status: 'running' | 'success' | 'error'
  error: string | null
}
