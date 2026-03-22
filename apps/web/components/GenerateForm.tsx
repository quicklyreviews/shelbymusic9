'use client'

import { useState } from 'react'
import { GenreSelector } from '@/components/GenreSelector'
import { Button } from '@/components/ui/Button'
import { GenerationStatus } from '@/components/GenerationStatus'
import { useGenerateMusic } from '@/hooks/useGenerateMusic'
import { ChevronDown, ChevronUp, Wand2, Plus, Sparkles } from 'lucide-react'
import type { Genre } from '@/types'

interface GenerateFormProps {
  genres: Genre[]
  defaultGenre?: string
  defaultPrompt?: string
}

const DURATION_OPTIONS = [15, 30, 60] as const

export function GenerateForm({ genres, defaultGenre = 'pop', defaultPrompt = '' }: GenerateFormProps) {
  const [selectedGenre, setSelectedGenre] = useState(defaultGenre)
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [lyrics, setLyrics] = useState('')
  const [duration, setDuration] = useState<30 | 15 | 60>(30)
  const [showLyrics, setShowLyrics] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [isAiWriting, setIsAiWriting] = useState(false)
  const [aiError, setAiError] = useState('')

  const { generate, reset, status, audioUrl, isSubmitting, error, elapsedMs } = useGenerateMusic()

  const isGenerating = status === 'pending' || status === 'processing'
  const isCompleted = status === 'completed'
  const isDisabled = isGenerating || isSubmitting

  const handleGenreChange = (id: string) => {
    if (isDisabled) return
    setSelectedGenre(id)
    const genre = genres.find(g => g.id === id)
    if (genre && (!prompt || prompt === genres.find(g => g.id === selectedGenre)?.prompt_template)) {
      setPrompt(genre.prompt_template)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationError('')
    if (!prompt.trim() || prompt.trim().length < 3) {
      setValidationError('Please describe the ringtone you want (at least 3 characters).')
      return
    }
    await generate({
      prompt: prompt.trim(),
      lyrics: lyrics.trim() || undefined,
      genre: selectedGenre,
      duration,
    })
  }

  const writeWithAI = async () => {
    if (!prompt.trim() || isAiWriting || isDisabled) return
    setIsAiWriting(true)
    setAiError('')
    try {
      const res = await fetch('/api/ai-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: prompt.trim(),
          genre: selectedGenre,
          lyrics: lyrics.trim(),
        }),
      })
      const data = await res.json()
      if (data.prompt) {
        setPrompt(data.prompt)
      } else {
        setAiError('AI could not generate a prompt. Try again.')
      }
    } catch {
      setAiError('Connection error. Try again.')
    } finally {
      setIsAiWriting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Form always visible — dims + locks during generation */}
      <form
        onSubmit={handleSubmit}
        className={`space-y-5 transition-opacity duration-300 ${isDisabled ? 'opacity-50 pointer-events-none select-none' : ''}`}
      >
        {/* Genre */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-brand-white">Genre</label>
          <GenreSelector genres={genres} selected={selectedGenre} onChange={handleGenreChange} />
        </div>

        {/* Prompt */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="prompt" className="text-sm font-medium text-brand-white">
              Describe your ringtone
            </label>
            <button
              type="button"
              onClick={writeWithAI}
              disabled={isDisabled || isAiWriting || !prompt.trim()}
              title="Let AI rewrite this as a professional music prompt"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-brand-orange/10 border border-brand-orange/30 text-brand-orange hover:bg-brand-orange hover:text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles size={11} className={isAiWriting ? 'animate-pulse' : ''} />
              {isAiWriting ? 'Writing...' : 'AI Write'}
            </button>
          </div>
          <textarea
            id="prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={isDisabled || isAiWriting}
            placeholder="Type your idea in any language — e.g. 'nhạc buồn nhớ người yêu' or 'upbeat summer party'"
            maxLength={500}
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg bg-bg-panel border border-bg-border text-brand-white placeholder-brand-text text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 focus:border-brand-orange transition-colors resize-none disabled:cursor-not-allowed"
          />
          {validationError && <p className="text-xs text-red-400">{validationError}</p>}
          {aiError && <p className="text-xs text-red-400">{aiError}</p>}
          <p className="text-xs text-brand-text text-right">{prompt.length}/500</p>
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-brand-white">Duration</label>
          <div className="flex gap-2">
            {DURATION_OPTIONS.map(d => (
              <button
                key={d}
                type="button"
                disabled={isDisabled}
                onClick={() => setDuration(d as 15 | 30 | 60)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all duration-150 disabled:cursor-not-allowed ${
                  duration === d
                    ? 'bg-brand-orange border-brand-orange text-white'
                    : 'bg-bg-panel border-bg-border text-brand-text hover:border-brand-orange hover:text-brand-white'
                }`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        {/* Lyrics (collapsible) */}
        <div className="space-y-2">
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => setShowLyrics(!showLyrics)}
            className="flex items-center gap-2 text-sm text-brand-text hover:text-brand-white transition-colors disabled:cursor-not-allowed"
          >
            {showLyrics ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Add lyrics (optional)
          </button>
          {showLyrics && (
            <textarea
              value={lyrics}
              onChange={e => setLyrics(e.target.value)}
              disabled={isDisabled}
              placeholder="Paste your lyrics here..."
              maxLength={2000}
              rows={5}
              className="w-full px-3 py-2.5 rounded-lg bg-bg-panel border border-bg-border text-brand-white placeholder-brand-text text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/50 focus:border-brand-orange transition-colors resize-none disabled:cursor-not-allowed"
            />
          )}
        </div>

        {/* Submit / Create Another */}
        {isCompleted ? (
          <Button type="button" variant="secondary" size="lg" onClick={reset} className="w-full">
            <Plus size={18} />
            Create Another
          </Button>
        ) : (
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isSubmitting || isGenerating}
            disabled={isDisabled}
            className="w-full"
          >
            {!isGenerating && <Wand2 size={18} />}
            {isGenerating ? 'Generating...' : 'Generate Ringtone'}
          </Button>
        )}
      </form>

      {/* Status panel */}
      {status && (
        <div className="border border-bg-border rounded-xl p-5 bg-bg-panel">
          <GenerationStatus
            status={status}
            audioUrl={audioUrl}
            elapsedMs={elapsedMs}
            error={error}
            onReset={reset}
          />
        </div>
      )}
    </div>
  )
}
