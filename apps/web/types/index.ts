// ============================================================
// Core domain types
// ============================================================

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface Ringtone {
  id: string
  created_at: string
  prompt: string
  lyrics: string
  genre: string
  duration_seconds: number
  seed: number | null
  status: JobStatus
  audio_url: string | null
  audio_size_kb: number | null
  generation_time_ms: number | null
  user_id: string | null
  title: string | null
  plays: number
  downloads: number
  is_public: boolean
}

export interface Genre {
  id: string
  name: string
  description: string | null
  prompt_template: string
  icon: string | null
  sort_order: number
}

// ============================================================
// API request/response types
// ============================================================

export interface GenerateRequest {
  prompt: string
  lyrics?: string
  genre: string
  duration: number
  seed?: number
  title?: string
}

export interface GenerateResponse {
  job_id: string
  status: 'processing'
}

export interface StatusResponse {
  status: JobStatus
  audio_url?: string
  generation_time_ms?: number
  error?: string
}

export interface WebhookPayload {
  job_id: string
  status: 'completed' | 'failed'
  audio_url?: string
  audio_data?: string        // base64 MP3 when STORAGE_PROVIDER=shelby
  audio_size_kb?: number
  generation_time_ms?: number
  error?: string
}

// ============================================================
// Modal payload (sent to GPU backend)
// ============================================================

export interface ModalPayload {
  prompt: string
  lyrics: string
  duration: number
  seed: number
  job_id: string
  webhook_url: string
}
