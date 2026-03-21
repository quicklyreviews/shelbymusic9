'use client'

import { useAudioPlayer } from '@/hooks/useAudioPlayer'
import { formatDuration } from '@/lib/utils'
import { Play, Pause, Volume2, VolumeX, Loader2 } from 'lucide-react'

interface AudioPlayerProps {
  src: string
  title?: string
  className?: string
}

export function AudioPlayer({ src, title, className = '' }: AudioPlayerProps) {
  const {
    audioRef, isPlaying, currentTime, duration,
    volume, muted, isLoading,
    toggle, seek, changeVolume, toggleMute,
  } = useAudioPlayer(src)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const displayVolume = muted ? 0 : volume

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek((e.clientX - rect.left) / rect.width)
  }

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    changeVolume((e.clientX - rect.left) / rect.width)
  }

  return (
    <div className={`bg-bg-panel border border-bg-border rounded-xl p-4 ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {title && (
        <p className="text-brand-white text-sm font-medium mb-3 truncate">{title}</p>
      )}

      <div className="flex items-center gap-3">
        {/* Play/Pause with loading indicator */}
        <button
          onClick={toggle}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-orange hover:bg-brand-orangeHover text-white flex-shrink-0 transition-colors"
        >
          {isLoading && isPlaying
            ? <Loader2 size={18} className="animate-spin" />
            : isPlaying
              ? <Pause size={18} />
              : <Play size={18} />
          }
        </button>

        {/* Progress */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs text-brand-text w-8 text-right tabular-nums">
            {formatDuration(Math.floor(currentTime))}
          </span>

          <div
            className="flex-1 h-1.5 bg-bg-border rounded-full cursor-pointer relative group"
            onClick={handleBarClick}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="Audio progress"
          >
            <div
              className="h-full bg-brand-orange rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-brand-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>

          <span className="text-xs text-brand-text w-8 tabular-nums">
            {duration > 0 ? formatDuration(Math.floor(duration)) : '--:--'}
          </span>
        </div>

        {/* Volume — expands on hover */}
        <div className="flex items-center gap-1.5 group/vol">
          <button
            onClick={toggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="text-brand-text hover:text-brand-white transition-colors flex-shrink-0"
          >
            {muted || displayVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <div
            className="w-0 overflow-hidden group-hover/vol:w-16 transition-all duration-200 cursor-pointer"
            onClick={handleVolumeClick}
            role="slider"
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayVolume * 100)}
          >
            <div className="w-16 h-1.5 bg-bg-border rounded-full relative">
              <div
                className="h-full bg-brand-text rounded-full"
                style={{ width: `${displayVolume * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
