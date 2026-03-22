import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { completeJob, markJobFailed } from '@/lib/storage'
import { uploadViaProcess, isShelbyConfigured } from '@/lib/shelby'
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

  if (payload.status === 'completed') {
    let audioUrl = payload.audio_url || ''

    if (payload.audio_data) {
      // Base64 MP3 sent inline (STORAGE_PROVIDER=shelby) — upload directly to Shelby
      try {
        const mp3Buffer = Buffer.from(payload.audio_data, 'base64')
        const { url: shelbyUrl, sizeKb } = await uploadViaProcess(mp3Buffer, payload.job_id)
        audioUrl = shelbyUrl
        console.log(`[webhook] Uploaded ${sizeKb}KB to Shelby: ${shelbyUrl}`)
      } catch (err) {
        console.error('[webhook] Shelby upload failed:', err)
      }
    } else if (isShelbyConfigured() && audioUrl) {
      // R2 URL → download → re-upload to Shelby
      try {
        const r2Res = await fetch(audioUrl)
        if (!r2Res.ok) throw new Error(`R2 download failed: ${r2Res.status}`)
        const mp3Buffer = Buffer.from(await r2Res.arrayBuffer())
        const { url: shelbyUrl, sizeKb } = await uploadViaProcess(mp3Buffer, payload.job_id)
        audioUrl = shelbyUrl
        console.log(`[webhook] Re-uploaded ${sizeKb}KB to Shelby: ${shelbyUrl}`)
      } catch (err) {
        console.error('[webhook] Shelby re-upload failed, keeping R2 URL:', err)
      }
    }

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

  revalidatePath('/generate')
  revalidatePath('/')
  revalidatePath('/library')

  return NextResponse.json({ ok: true })
}
