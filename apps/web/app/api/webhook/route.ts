import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { completeJob, markJobFailed } from '@/lib/storage'
import { uploadViaProcess } from '@/lib/shelby'
import type { WebhookPayload } from '@/types'

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.WEBHOOK_SECRET
  if (webhookSecret) {
    const received = req.headers.get('x-webhook-secret')
    if (received !== webhookSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let payload: WebhookPayload
  try { payload = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!payload.job_id || !payload.status) {
    return NextResponse.json({ error: 'Missing job_id or status' }, { status: 400 })
  }

  try {
    if (payload.status === 'completed') {
      const audioUrl = payload.audio_url || ''
      await completeJob(payload.job_id, {
        audio_url: audioUrl,
        audio_size_kb: payload.audio_size_kb,
        generation_time_ms: payload.generation_time_ms,
      })
    } else if (payload.status === 'failed') {
      await markJobFailed(payload.job_id)
    } else {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
  } catch (err) {
    console.error('[webhook] DB update failed:', err)
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
  }

  revalidatePath('/generate')
  revalidatePath('/')
  revalidatePath('/library')

  return NextResponse.json({ ok: true })
}
