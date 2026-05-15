'use client'

import { useState, useEffect, useRef } from 'react'
import { Sound, SyncStatus } from '@/types'

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function Home() {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [results, setResults] = useState<Sound[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const LIMIT = 30

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories)
    fetch('/api/sync/status').then(r => r.json()).then(setSyncStatus)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(q, category, 0)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [q, category])

  useEffect(() => {
    doSearch(q, category, offset)
  }, [offset])

  async function doSearch(query: string, cat: string, off: number) {
    setLoading(true)
    const params = new URLSearchParams({ q: query, category: cat, limit: String(LIMIT), offset: String(off) })
    const res = await fetch(`/api/search?${params}`)
    const data = await res.json()
    setResults(data.results ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }

  function handleQChange(val: string) {
    setQ(val)
    setOffset(0)
  }

  function handleCategoryChange(val: string) {
    setCategory(val)
    setOffset(0)
  }

  function clearFilters() {
    setQ('')
    setCategory('')
    setOffset(0)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearFilters()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const totalPages = Math.ceil(total / LIMIT)
  const currentPage = Math.floor(offset / LIMIT) + 1

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6 tracking-tight">SoundVault</h1>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={q}
            onChange={e => handleQChange(e.target.value)}
            placeholder="Search sounds..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-4 py-2 text-sm focus:outline-none focus:border-gray-500"
          />
        </div>

        <div className="flex gap-2 mb-6 items-center">
          <select
            value={category}
            onChange={e => handleCategoryChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
          >
            <option value="">All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {(q || category) && (
            <button
              onClick={clearFilters}
              className="text-sm text-gray-400 hover:text-gray-200 underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <p className="text-sm text-gray-400 mb-4">
          {loading ? 'Loading...' : `Showing ${results.length} of ${total.toLocaleString()} results`}
        </p>

        <div className="space-y-2 mb-6">
          {results.map(s => (
            <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{s.name_clean}</span>
                    <span className="shrink-0 text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">{s.extension.replace('.', '')}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {s.category}
                    {s.tags.length > 0 && <span> · {s.tags.join(' ')}</span>}
                  </div>
                  {s.file_size && (
                    <div className="text-xs text-gray-500 mt-0.5">{formatBytes(s.file_size)}</div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={s.web_view_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 rounded transition-colors"
                  >
                    Open ↗
                  </a>
                  <a
                    href={s.download_link}
                    download
                    className="text-xs bg-blue-700 hover:bg-blue-600 px-2.5 py-1.5 rounded transition-colors"
                  >
                    Download ↓
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mb-8">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="text-sm px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-sm text-gray-400">Page {currentPage} of {totalPages}</span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="text-sm px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}

        <div className="border-t border-gray-800 pt-4 text-xs text-gray-500">
          {syncStatus
            ? `Last synced ${timeAgo(syncStatus.finished_at)} · ${syncStatus.files_upserted.toLocaleString()} files`
            : 'Sync status unavailable'}
        </div>
      </div>
    </main>
  )
}
