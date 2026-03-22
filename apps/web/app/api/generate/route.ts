import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGenreTemplate, createRingtone, markJobFailed } from '@/lib/storage'
import { generateSeed, buildWebhookUrl } from '@/lib/utils'
import type { ModalPayload } from '@/types'

const GenerateSchema = z.object({
  prompt: z.string().min(3, 'Prompt must be at least 3 characters').max(500, 'Prompt too long'),
  lyrics: z.string().max(2000, 'Lyrics too long').optional().default(''),
  genre: z.string().min(1).max(50),
  duration: z.number().int().min(5).max(120),
  seed: z.number().int().optional(),
  title: z.string().max(200).optional(),
})

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_HOUR || '5')

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000
  const timestamps = (rateLimitMap.get(ip) || []).filter(t => now - t < windowMs)
  if (timestamps.length >= RATE_LIMIT) return true
  timestamps.push(now)
  rateLimitMap.set(ip, timestamps)
  return false
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please wait before generating again.' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = GenerateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 })
  }

  const { prompt, lyrics, genre, duration, seed, title } = parsed.data
  const finalSeed = seed ?? generateSeed()

  const modalEndpoint = process.env.MODAL_ENDPOINT_URL
  if (!modalEndpoint) {
    return NextResponse.json({ error: 'GPU backend not configured' }, { status: 503 })
  }

  try {
    const template = await getGenreTemplate(genre)
    const enrichedPrompt = template ? `${template}, ${prompt}` : prompt

    const jobId = await createRingtone({
      prompt: enrichedPrompt,
      lyrics: lyrics || '',
      genre,
      duration_seconds: duration,
      seed: finalSeed,
      title: title || null,
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const modalPayload: ModalPayload = {
      prompt: enrichedPrompt,
      lyrics: lyrics || '',
      duration,
      seed: finalSeed,
      job_id: jobId,
      webhook_url: buildWebhookUrl(appUrl, jobId),
    }

    // Fire-and-forget with 3 retries — auto-fail job if all attempts fail
    ;(async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(modalEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(modalPayload),
            signal: AbortSignal.timeout(15_000),
          })
          if (res.ok) {
            console.log(`[generate] Modal dispatch ok (attempt ${attempt})`)
            return
          }
          console.error(`[generate] Modal returned ${res.status} (attempt ${attempt})`)
        } catch (err) {
          console.error(`[generate] Modal dispatch attempt ${attempt} failed:`, (err as Error).message)
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt))
      }
      console.error(`[generate] All retries failed for job ${jobId}, marking failed`)
      await markJobFailed(jobId)
    })()

    return NextResponse.json({ job_id: jobId, status: 'processing' })
  } catch (err) {
    console.error('Generate error:', err)
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }
}
