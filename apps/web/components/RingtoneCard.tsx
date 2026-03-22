'use client'

import { useState } from 'react'
import { Play, Pause, Download, Music } from 'lucide-react'
import { formatDuration, truncate, timeAgo } from '@/lib/utils'
import type { Ringtone } from '@/types'

interface RingtoneCardProps {
  ringtone: Ringtone
}

export function RingtoneCard({ ringtone }: RingtoneCardProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useState<HTMLAudioElement | null>(null)

  const toggle = () => {
    let audio = audioRef[0]
    if (!audio && ringtone.audio_url) {
      audio = new Audio(ringtone.audio_url)
      audio.onended = () => setIsPlaying(false)
      audioRef[1](audio)
    }
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().catch(() => {})
      setIsPlaying(true)
    }
  }

  const displayTitle = ringtone.title || truncate(ringtone.prompt, 40)

  return (
    <div className="bg-bg-panel border border-bg-border rounded-xl p-4 hover:border-brand-orange/40 transition-all duration-200 group">
      {/* Icon row */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg bg-brand-orange/10 flex items-center justify-center flex-shrink-0">
          <Music size={18} className="text-brand-orange" />
        </div>
        <span className="text-xs text-brand-text bg-bg-border px-2 py-1 rounded-full capitalize">
          {ringtone.genre}
        </span>
      </div>

      {/* Title */}
      <p className="text-brand-white text-sm font-medium mb-1 leading-snug">
        {displayTitle}
      </p>
      <p className="text-xs text-brand-text mb-4">
        {formatDuration(ringtone.duration_seconds)} · {timeAgo(ringtone.created_at)}
      </p>

      {/* Storage badge */}
      {ringtone.audio_url && (
        <a
          href={`/preview?url=${encodeURIComponent(ringtone.audio_url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-text hover:text-brand-orange transition-colors mb-3"
        >
          {ringtone.audio_url.includes('shelby.xyz') ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block flex-shrink-0" /> Shelby testnet</>
          ) : ringtone.audio_url.includes('r2.dev') ? (
            <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block flex-shrink-0" /> Cloudflare R2</>
          ) : (
            <><span className="w-1.5 h-1.5 rounded-full bg-brand-text inline-block flex-shrink-0" /> Audio</>
          )}
        </a>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          disabled={!ringtone.audio_url}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-brand-orange/10 hover:bg-brand-orange text-brand-orange hover:text-white text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        {ringtone.audio_url && (
          <a
            href={ringtone.audio_url}
            download={`${displayTitle}.mp3`}
            aria-label="Download MP3"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-bg-border hover:border-brand-orange text-brand-text hover:text-brand-orange transition-all duration-150"
          >
            <Download size={14} />
          </a>
        )}
      </div>
    </div>
  )
}
