'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { submitGeneration, pollStatus } from '@/lib/api'
import type { GenerateRequest, JobStatus } from '@/types'

const TIMEOUT_MS = 5 * 60 * 1000

export interface UseGenerateMusicReturn {
  generate: (input: GenerateRequest) => Promise<void>
  reset: () => void
  status: JobStatus | null
  audioUrl: string | null
  isSubmitting: boolean
  error: string | null
  elapsedMs: number
  jobId: string | null
}

export function useGenerateMusic(): UseGenerateMusicReturn {
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const elapsedRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)
  const activeRef = useRef(false)

  const stopPolling = () => {
    activeRef.current = false
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
  }

  const reset = () => {
    stopPolling()
    setJobId(null)
    setStatus(null)
    setAudioUrl(null)
    setIsSubmitting(false)
    setError(null)
    setElapsedMs(0)
  }

  // Adaptive polling: 2s for first 30s, 5s after — saves ~18 req/min during slow GPU generation
  const schedulePoll = useCallback((id: string) => {
    if (!activeRef.current) return
    const elapsed = Date.now() - startTimeRef.current
    const interval = elapsed > 30_000 ? 5000 : 2000

    pollRef.current = setTimeout(async () => {
      if (!activeRef.current) return

      if (Date.now() - startTimeRef.current > TIMEOUT_MS) {
        stopPolling()
        setStatus('failed')
        setError('Generation timed out. Please try again.')
        return
      }

      try {
        const result = await pollStatus(id)
        if (!activeRef.current) return
        setStatus(result.status)

        if (result.status === 'completed') {
          setAudioUrl(result.audio_url || null)
          stopPolling()
        } else if (result.status === 'failed') {
          setError(result.error || 'Generation failed. Please try again.')
          stopPolling()
        } else {
          schedulePoll(id)
        }
      } catch {
        if (activeRef.current) schedulePoll(id) // retry on transient network error
      }
    }, interval)
  }, [])

  useEffect(() => {
    if (!jobId) return

    activeRef.current = true
    startTimeRef.current = Date.now()

    // 250ms tick for smooth progress bar animation
    elapsedRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current)
    }, 250)

    schedulePoll(jobId)
    return stopPolling
  }, [jobId, schedulePoll])

  const generate = async (input: GenerateRequest) => {
    reset()
    setIsSubmitting(true)
    try {
      const response = await submitGeneration(input)
      setJobId(response.job_id)
      setStatus('processing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start generation')
      setStatus('failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return { generate, reset, status, audioUrl, isSubmitting, error, elapsedMs, jobId }
}
