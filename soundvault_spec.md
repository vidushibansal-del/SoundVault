# SoundVault — Project Specification
**LLM Code Generation Master Document**
*Version 1.2 | Simple, minimal, functional*

---

## 0. Project Summary

**SoundVault** is a serverless sound library search tool. It indexes ~10,000 audio files from a Google Drive folder into Supabase, and exposes a fast full-text + category search UI. Auto-syncs metadata every 3 hours via Vercel Cron. Fully public — no auth. Clicking a result opens the file in Google Drive in a new tab.

**Stack:** Next.js 14 (App Router) · TypeScript · Supabase (Postgres) · Tailwind CSS · Vercel

---

## 1. Constraints

| Constraint | Value |
|---|---|
| Serverless | Yes — Next.js API Routes only |
| Auth | None — fully public |
| Drive folder depth | 1 level: `/Category/file.wav` |
| Filename format | Mixed/inconsistent — heuristic tag parser |
| Search | Supabase Postgres full-text search + category filter |
| Drive click | Open `webViewLink` in new tab. Separate download via `webContentLink`. |
| Sync interval | Every 3 hours, Vercel Cron → `/api/sync` |
| Drive auth | OAuth 2.0 personal account. Refresh token in env var. |
| File types | `.wav`, `.mp3`, `.aiff`, `.flac`, `.ogg` only |

---

## 2. Architecture

```
Google Drive
    │  (every 3h, Vercel Cron)
    ▼
/api/sync
  → Exchange refresh token → access token
  → Drive API: list all files in root folder (paginated)
  → Parse filename → tags[], parent folder name → category
  → Upsert into Supabase `sounds` table
  → Delete rows no longer in Drive
    │
    ▼
Supabase Postgres (`sounds` table)
  → GIN index on tsvector (category + name + tags)
    │
    ▼
Next.js `/` (single page)
  → Search input (debounced 300ms) → /api/search
  → Category dropdown filter
  → Results list: name, category, tags, Open + Download buttons
```

---

## 3. Database Schema

### `sounds` table

```sql
create extension if not exists pg_trgm;

create table sounds (
  id            uuid primary key default gen_random_uuid(),
  drive_id      text not null unique,
  name          text not null,              -- raw filename with extension
  name_clean    text not null,              -- filename without extension, spaces normalized
  category      text not null,             -- parent folder name on Drive
  tags          text[] not null default '{}',
  extension     text not null,
  web_view_link text not null,
  download_link text not null,
  file_size     bigint,
  modified_in_drive timestamptz,
  indexed_at    timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english',
      coalesce(category, '') || ' ' ||
      coalesce(name_clean, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  ) stored
);

create index idx_sounds_fts      on sounds using gin(search_vector);
create index idx_sounds_tags     on sounds using gin(tags);
create index idx_sounds_category on sounds(category);
```

### `sync_log` table

```sql
create table sync_log (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  files_upserted int default 0,
  files_deleted  int default 0,
  status         text default 'running',   -- 'running' | 'success' | 'error'
  error          text
);
```

### RLS

```sql
alter table sounds   enable row level security;
alter table sync_log enable row level security;

-- sounds: public read
create policy "public read" on sounds for select using (true);
-- sync_log: server-only via service role key, no client policy needed
```

---

## 4. Tag Parsing (`lib/parseTags.ts`)

Single exported function `parseTags(filename: string): { nameClean: string, tags: string[] }`.

```
1. Strip file extension
2. Replace _ - . ( ) [ ] with space
3. Trim and collapse multiple spaces → nameClean
4. Split nameClean → tokens
5. Lowercase each token
6. Remove stop words: the a an and or in of at by for to with from is it
7. Remove pure-numeric tokens under 3 chars (keep "808", "120bpm")
8. Remove tokens under 2 chars
9. Deduplicate
10. Return { nameClean, tags }
```

---

## 5. Google Drive Sync — `app/api/sync/route.ts`

Drive auth and file listing logic lives inline in this file — it is only used here, no need for a separate lib.

### Env vars needed
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_DRIVE_ROOT_FOLDER_ID
CRON_SECRET
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_URL
```

### Protection
```ts
if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}
```

### Sync steps

```
1. Insert sync_log row (status='running')

2. POST https://oauth2.googleapis.com/token
   body: { client_id, client_secret, refresh_token, grant_type: 'refresh_token' }
   → access_token

3. Drive API files.list loop (pageSize=1000, pageToken pagination):
   q: "'ROOT_FOLDER_ID' in parents and trashed=false"
   fields: id, name, parents, mimeType, size, modifiedTime, webViewLink, webContentLink
   Filter out: mimeType=folder, non-audio extensions

4. Collect unique parent folder IDs → fetch each folder name via files.get
   Cache in Map<folderId, folderName>

5. For each file:
   - category = folderNameMap.get(file.parents[0]) ?? 'Uncategorized'
   - { nameClean, tags } = parseTags(file.name)
   - download_link = `https://drive.google.com/uc?export=download&id=${file.id}`
   - build upsert row

6. Supabase upsert in batches of 500, onConflict: 'drive_id'

7. Delete from sounds where drive_id not in fetched ID list

8. Update sync_log: status='success', files_upserted, files_deleted, finished_at=now()

CATCH: update sync_log status='error', error=message; return 500
```

---

## 6. Search API — `app/api/search/route.ts`

### Query params

| Param | Type | Default |
|---|---|---|
| `q` | string | '' |
| `category` | string | '' |
| `limit` | number | 30 |
| `offset` | number | 0 |

Tags are not a separate filter — they are folded into `search_vector`, so searching "808 dark" matches files tagged with both automatically.

### Logic

```ts
const sb = createClient(url, anonKey)

let query = sb.from('sounds').select('*', { count: 'exact' })

if (q.trim()) {
  query = query.textSearch('search_vector', q.trim(), { type: 'websearch' })
} else {
  query = query.order('modified_in_drive', { ascending: false })
}

if (category) query = query.ilike('category', category)

query = query.range(offset, offset + limit - 1)

const { data, count, error } = await query
return Response.json({ results: data, total: count, offset, limit })
```

`type: 'websearch'` handles prefix matching and multi-word queries — no manual tsquery sanitization needed.

### Response
```ts
{ results: Sound[], total: number, offset: number, limit: number }
```

---

## 7. Frontend — `app/page.tsx`

Everything lives in one page component. No separate component files.

### State
```ts
const [q, setQ]               = useState('')
const [category, setCategory] = useState('')
const [results, setResults]   = useState<Sound[]>([])
const [total, setTotal]       = useState(0)
const [offset, setOffset]     = useState(0)
const [loading, setLoading]   = useState(false)
const [categories, setCategories] = useState<string[]>([])
const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
```

### On mount (once)
- Fetch `/api/categories` → `setCategories`
- Fetch `/api/sync/status` → `setSyncStatus`
- Run initial search (empty q, shows latest 30 files)

### Search trigger
`useEffect` on `[q, category, offset]`. Debounce `q` changes by 300ms using `useRef` timeout. Reset offset to 0 on q or category change.

### UI layout
```
┌─────────────────────────────────────────┐
│  SoundVault                             │
├─────────────────────────────────────────┤
│  [Search.................................] │
│  Category: [All ▾]  [Clear filters]     │
├─────────────────────────────────────────┤
│  Showing 30 of 9842 results             │
│  ┌──────────────────────────────────┐   │
│  │ name_clean              [wav]    │   │
│  │ Drums · kick dark 808            │   │
│  │ 2.4 MB  [Open ↗]  [Download ↓]  │   │
│  └──────────────────────────────────┘   │
│  (× 30 cards)                           │
│  [← Prev]   Page 1 of 328   [Next →]   │
├─────────────────────────────────────────┤
│  Last synced 2h ago · 9,842 files       │
└─────────────────────────────────────────┘
```

### Behavior notes
- Empty q + no category: 30 most recently modified files (default landing)
- `Escape` key clears search input and resets to default view
- Loading: simple `loading && <p>Loading...</p>` — no skeleton
- No URL param sync needed
- Pagination: prev/next buttons + "Page X of Y" text
- Each result card: name_clean, category · tags joined by space, extension badge, file size, Open button (target="_blank"), Download button (anchor with download attr)

---

## 8. Additional API Routes

### `app/api/categories/route.ts`
```ts
const { data } = await sb.from('sounds')
  .select('category')
  .order('category')
const unique = [...new Set((data ?? []).map(r => r.category))]
return Response.json(unique)
```

### `app/api/sync/status/route.ts`
```ts
const { data } = await sb.from('sync_log')
  .select('*')
  .order('started_at', { ascending: false })
  .limit(1)
  .single()
return Response.json(data)
```

Both use the anon Supabase client — sync_log has no RLS select policy so this returns nothing from the client unless you add one. Add a public read policy to sync_log if you want the status bar to work from the anon key; otherwise use the service role key in these two routes.

> **Decision:** Use service role key in `/api/sync/status` and `/api/categories` routes (server-side routes, safe). Use anon key only in `/api/search`.

---

## 9. File Structure

```
soundvault/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                  # entire UI — no separate component files
│   └── api/
│       ├── search/route.ts
│       ├── categories/route.ts
│       ├── sync/route.ts
│       └── sync/status/route.ts
├── lib/
│   ├── supabase.ts               # export two clients: anonClient, serviceClient
│   └── parseTags.ts
├── types.ts                      # Sound, SyncStatus interfaces
├── vercel.json
└── supabase/
    └── migrations/
        └── 001_init.sql
```

10 files total (excluding config). That's it.

---

## 10. `types.ts`

```ts
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
```

---

## 11. `lib/supabase.ts`

```ts
import { createClient } from '@supabase/supabase-js'

export const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

---

## 12. Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
CRON_SECRET=
```

---

## 13. `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/sync",
      "schedule": "0 */3 * * *"
    }
  ]
}
```

Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` — set `CRON_SECRET` in Vercel project env vars.

---

## 14. Dependencies

```json
{
  "dependencies": {
    "next": "14.x",
    "@supabase/supabase-js": "latest"
  },
  "devDependencies": {
    "typescript": "5.x",
    "tailwindcss": "3.x",
    "@types/node": "latest",
    "@types/react": "latest"
  }
}
```

2 runtime dependencies. No SWR, no clsx, no utility libs. Plain `fetch` in `useEffect`. Tailwind for styling.

---

## 15. Out of Scope (v1)

- In-page audio player / waveform
- Clickable tag chips (full-text search covers the use case)
- AI tagging
- Analytics

---

## 16. Implementation Order

1. `supabase/migrations/001_init.sql`
2. `lib/parseTags.ts`
3. `types.ts`
4. `lib/supabase.ts`
5. `app/api/sync/route.ts`
6. `app/api/search/route.ts`
7. `app/api/categories/route.ts`
8. `app/api/sync/status/route.ts`
9. `app/page.tsx`
10. `app/layout.tsx`
11. `vercel.json`
