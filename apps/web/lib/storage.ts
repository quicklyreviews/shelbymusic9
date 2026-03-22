/**
 * Unified data access layer
 * - Local dev: SQLite (better-sqlite3) — zero setup, file-based
 * - Vercel / production: Supabase — detected via VERCEL env var
 *   Override: DATABASE_PROVIDER=sqlite | supabase
 */
import type { Genre, Ringtone } from '@/types'

function useSupabase(): boolean {
  const p = process.env.DATABASE_PROVIDER
  if (p === 'sqlite') return false
  if (p === 'supabase') return true
  return !!process.env.VERCEL // Vercel sets this automatically
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface InsertRingtoneData {
  prompt: string
  lyrics: string
  genre: string
  duration_seconds: number
  seed: number
  title?: string | null
}

export interface JobStatus {
  id: string
  status: string
  audio_url: string | null
  generation_time_ms: number | null
  created_at: string
}

// ─── SQLite helpers ───────────────────────────────────────────────────────

function sqliteDb() {
  // Dynamic require keeps better-sqlite3 out of client bundles
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDb, rowToRingtone } = require('./db') as typeof import('./db')
  return { db: getDb(), rowToRingtone }
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function getAllGenres(): Promise<Genre[]> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { data } = await getSupabaseAdminClient().from('genres').select('*').order('sort_order')
    return (data as Genre[]) || []
  }
  const { db } = sqliteDb()
  return db.prepare('SELECT * FROM genres ORDER BY sort_order').all() as Genre[]
}

export async function getGenreTemplate(genreId: string): Promise<string | null> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { data } = await getSupabaseAdminClient()
      .from('genres').select('prompt_template').eq('id', genreId).single()
    return (data as { prompt_template: string } | null)?.prompt_template ?? null
  }
  const { db } = sqliteDb()
  const row = db.prepare('SELECT prompt_template FROM genres WHERE id = ?').get(genreId) as
    | { prompt_template: string } | undefined
  return row?.prompt_template ?? null
}

export async function createRingtone(data: InsertRingtoneData): Promise<string> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { data: row, error } = await getSupabaseAdminClient()
      .from('ai_ringtones')
      .insert({ ...data, status: 'processing', is_public: true })
      .select('id')
      .single()
    if (error || !row) throw new Error(error?.message || 'Insert failed')
    return (row as { id: string }).id
  }
  const { db } = sqliteDb()
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO ai_ringtones (id, created_at, prompt, lyrics, genre, duration_seconds, seed, status, title, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, 1)
  `).run(id, new Date().toISOString(), data.prompt, data.lyrics, data.genre,
         data.duration_seconds, data.seed, data.title ?? null)
  return id
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { data } = await getSupabaseAdminClient()
      .from('ai_ringtones')
      .select('id, status, audio_url, generation_time_ms, created_at')
      .eq('id', jobId)
      .single()
    return data as JobStatus | null
  }
  const { db } = sqliteDb()
  return db.prepare(
    'SELECT id, status, audio_url, generation_time_ms, created_at FROM ai_ringtones WHERE id = ?'
  ).get(jobId) as JobStatus | null
}

export async function markJobFailed(jobId: string): Promise<void> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    await getSupabaseAdminClient().from('ai_ringtones').update({ status: 'failed' }).eq('id', jobId)
    return
  }
  sqliteDb().db.prepare(`UPDATE ai_ringtones SET status = 'failed' WHERE id = ?`).run(jobId)
}

export async function completeJob(
  jobId: string,
  result: { audio_url: string; audio_size_kb?: number; generation_time_ms?: number }
): Promise<void> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { error } = await getSupabaseAdminClient().from('ai_ringtones').update({
      status: 'completed',
      audio_url: result.audio_url,
      audio_size_kb: result.audio_size_kb ?? null,
      generation_time_ms: result.generation_time_ms ?? null,
    }).eq('id', jobId)
    if (error) throw new Error(`completeJob failed: ${error.message}`)
    return
  }
  sqliteDb().db.prepare(`
    UPDATE ai_ringtones SET status = 'completed', audio_url = ?, audio_size_kb = ?, generation_time_ms = ?
    WHERE id = ?
  `).run(result.audio_url, result.audio_size_kb ?? null, result.generation_time_ms ?? null, jobId)
}

export async function getRecentRingtones(limit = 6): Promise<Ringtone[]> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { data } = await getSupabaseAdminClient()
      .from('ai_ringtones')
      .select('*')
      .eq('status', 'completed')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data as Ringtone[]) || []
  }
  const { db, rowToRingtone } = sqliteDb()
  return (db.prepare(
    `SELECT * FROM ai_ringtones WHERE status = 'completed' AND is_public = 1 ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as Record<string, unknown>[]).map(rowToRingtone)
}

export async function getRingtonesByGenre(genre: string | undefined, limit = 48): Promise<Ringtone[]> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    let q = getSupabaseAdminClient()
      .from('ai_ringtones').select('*').eq('status', 'completed').eq('is_public', true)
      .order('created_at', { ascending: false }).limit(limit)
    if (genre) q = q.eq('genre', genre)
    const { data } = await q
    return (data as Ringtone[]) || []
  }
  const { db, rowToRingtone } = sqliteDb()
  const rows = genre
    ? db.prepare(`SELECT * FROM ai_ringtones WHERE status='completed' AND is_public=1 AND genre=? ORDER BY created_at DESC LIMIT ?`).all(genre, limit)
    : db.prepare(`SELECT * FROM ai_ringtones WHERE status='completed' AND is_public=1 ORDER BY created_at DESC LIMIT ?`).all(limit)
  return (rows as Record<string, unknown>[]).map(rowToRingtone)
}

export async function getPublicRingtoneById(id: string): Promise<Ringtone | null> {
  if (useSupabase()) {
    const { getSupabaseAdminClient } = await import('./supabase')
    const { data } = await getSupabaseAdminClient()
      .from('ai_ringtones').select('*').eq('id', id).eq('status', 'completed').single()
    return data as Ringtone | null
  }
  const { db, rowToRingtone } = sqliteDb()
  const row = db.prepare(
    `SELECT * FROM ai_ringtones WHERE id = ? AND status = 'completed'`
  ).get(id) as Record<string, unknown> | undefined
  return row ? rowToRingtone(row) : null
}
