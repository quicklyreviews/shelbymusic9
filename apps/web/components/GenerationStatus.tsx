'use client'

import { AudioPlayer } from '@/components/ui/AudioPlayer'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatDuration } from '@/lib/utils'
import { CheckCircle, XCircle } from 'lucide-react'
import type { JobStatus } from '@/types'

interface GenerationStatusProps {
  status: JobStatus
  audioUrl: string | null
  elapsedMs: number
  error: string | null
  onReset: () => void
}

const PHASE_LABELS = [
  'Loading AI model...',
  'Composing melody...',
  'Adding harmonics...',
  'Mixing instruments...',
  'Mastering audio...',
]

// Asymptotic curve: ~60% at 30s, ~83% at 60s, ~91% at 90s — feels honest, not stuck
function computeProgress(elapsedMs: number): number {
  return Math.min(95, 95 * (1 - Math.exp(-elapsedMs / 45_000)))
}

export function GenerationStatus({ status, audioUrl, elapsedMs, error, onReset }: GenerationStatusProps) {
  const progress = status === 'completed' ? 100 : computeProgress(elapsedMs)
  const phaseIdx = Math.min(PHASE_LABELS.length - 1, Math.floor((progress / 95) * PHASE_LABELS.length))
  const elapsedSec = Math.floor(elapsedMs / 1000)

  if (status === 'completed' && audioUrl) {
    return (
      <div className="animate-slide-up space-y-4">
        <div className="flex items-center gap-2 text-brand-success">
          <CheckCircle size={20} />
          <span className="font-semibold">Ringtone ready!</span>
          {elapsedSec > 0 && (
            <span className="text-brand-text text-sm ml-auto">
              Generated in {formatDuration(elapsedSec)}
            </span>
          )}
        </div>
        <AudioPlayer src={audioUrl} title="Your AI Ringtone" />
        <a
          href={audioUrl}
          download="ringtone.mp3"
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-orange hover:bg-brand-orangeHover text-white font-semibold text-sm transition-colors"
        >
          Download MP3
        </a>
        <a
          href={`/preview?url=${encodeURIComponent(audioUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-text hover:text-brand-orange transition-colors"
        >
          {audioUrl.includes('shelby.xyz') ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Stored on Shelby testnet</>
          ) : audioUrl.includes('r2.dev') ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" /> Stored on Cloudflare R2</>
          ) : (
            <><span className="w-1.5 h-1.5 rounded-full bg-brand-text inline-block" /> View audio</>
          )}
        </a>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="animate-fade-in space-y-3">
        <div className="flex items-center gap-2 text-red-400">
          <XCircle size={20} />
          <span className="font-semibold">Generation failed</span>
        </div>
        {error && <p className="text-brand-text text-sm">{error}</p>}
        <Button variant="primary" onClick={onReset}>Try Again</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-brand-text">
        <LoadingSpinner size={18} className="text-brand-orange" />
        <span className="text-sm">{PHASE_LABELS[phaseIdx]}</span>
        <span className="ml-auto text-xs tabular-nums">{elapsedSec}s</span>
      </div>

      <div className="w-full h-1.5 bg-bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-orange rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {elapsedSec > 25 && (
        <p className="text-xs text-brand-text">
          AI generation typically takes 60–90s on GPU. Hang tight!
        </p>
      )}
    </div>
  )
}
