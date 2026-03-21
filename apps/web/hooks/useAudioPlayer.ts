'use client'

import { useEffect, useRef, useState } from 'react'

export function useAudioPlayer(src: string) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onDurationChange = () => setDuration(audio.duration || 0)
    const onEnded = () => setIsPlaying(false)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onCanPlay = () => setIsLoading(false)
    const onWaiting = () => setIsLoading(true)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onDurationChange)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('waiting', onWaiting)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onDurationChange)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('waiting', onWaiting)
    }
  }, [src])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.pause()
    else audio.play().catch(() => {})
  }

  const seek = (fraction: number) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * duration
  }

  const changeVolume = (v: number) => {
    const audio = audioRef.current
    const clamped = Math.max(0, Math.min(1, v))
    if (audio) {
      audio.volume = clamped
      audio.muted = clamped === 0
    }
    setVolume(clamped)
    setMuted(clamped === 0)
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (!audio) return
    const next = !muted
    audio.muted = next
    setMuted(next)
  }

  return { audioRef, isPlaying, currentTime, duration, volume, muted, isLoading, toggle, seek, changeVolume, toggleMute }
}
