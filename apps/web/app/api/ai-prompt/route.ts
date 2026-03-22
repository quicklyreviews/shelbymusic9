import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `You are the most celebrated music composer and songwriter in history — combining Hans Zimmer's orchestral depth, Pharrell Williams's genre intuition, Max Martin's pop instincts, and Ennio Morricone's emotional storytelling.

Your task: Transform ANY music idea (in any language) into a precise AI music generation prompt.

Rules:
- Output ONLY the prompt text — no intro, no explanation, no quotes, no labels
- Always write in English
- Include: musical style, key instruments, tempo (BPM), mood, dynamics, rhythm feel
- Maximum 220 characters — every word must earn its place
- Think like you're briefing a world-class studio session musician`

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'DEEPSEEK_API_KEY not configured' }, { status: 503 })
  }

  let body: { description?: string; genre?: string; lyrics?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { description = '', genre = '', lyrics = '' } = body
  if (!description.trim()) {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  }

  const userMessage = [
    `Music idea: "${description.trim()}"`,
    genre ? `Genre: ${genre}` : '',
    lyrics ? `Lyrics/theme: "${lyrics.slice(0, 200)}"` : '',
    '\nWrite the music generation prompt:',
  ].filter(Boolean).join('\n')

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 120,
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(20_000),
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', fetchOptions)
      if (!res.ok) {
        const err = await res.text()
        console.error('[ai-prompt] DeepSeek error:', res.status, err)
        return NextResponse.json({ error: 'AI service error' }, { status: 502 })
      }
      const data = await res.json()
      const prompt = data.choices?.[0]?.message?.content?.trim()
      if (!prompt) return NextResponse.json({ error: 'Empty response' }, { status: 502 })
      return NextResponse.json({ prompt })
    } catch (err) {
      console.error(`[ai-prompt] Attempt ${attempt} failed:`, (err as Error).message)
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  return NextResponse.json({ error: 'Request failed after retries' }, { status: 500 })
}
