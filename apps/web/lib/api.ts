import type { GenerateRequest, GenerateResponse, StatusResponse } from '@/types'

/**
 * Submit a ringtone generation request.
 * Returns the job_id immediately — generation happens async.
 */
export async function submitGeneration(request: GenerateRequest): Promise<GenerateResponse> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Poll the status of a generation job.
 */
export async function pollStatus(jobId: string): Promise<StatusResponse> {
  const res = await fetch(`/api/status/${jobId}?_t=${Date.now()}`, { cache: 'no-store' })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Status check failed: ${res.status}`)
  }

  return res.json()
}
