import Link from 'next/link'
import { getAllGenres, getRecentRingtones } from '@/lib/storage'
import { RingtoneCard } from '@/components/RingtoneCard'
import { ArrowRight, Wand2, Download, Zap } from 'lucide-react'

const GENRE_ICONS: Record<string, string> = {
  pop: '🎵', rock: '🎸', edm: '⚡', hiphop: '🎤', lofi: '☕',
  classical: '🎻', jazz: '🎷', ambient: '🌙', funk: '🕺', kpop: '✨',
}

async function getHomepageData() {
  try {
    const [genres, ringtones] = await Promise.all([getAllGenres(), getRecentRingtones(6)])
    return { genres, ringtones }
  } catch {
    return { genres: [], ringtones: [] }
  }
}

export default async function HomePage() {
  const { genres, ringtones } = await getHomepageData()

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-20">
      {/* Hero */}
      <section className="text-center space-y-6 py-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-orange/10 border border-brand-orange/20 text-brand-orange text-sm font-medium mb-2">
          <Zap size={14} />
          Powered by MusicGen AI
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-white leading-tight">
          Create AI Ringtones
          <br />
          <span className="text-brand-orange">in 60 Seconds</span>
        </h1>
        <p className="text-lg text-brand-text max-w-xl mx-auto">
          Describe the music you want, pick a genre, and our AI generates a unique MP3 ringtone — completely free.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/generate"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-lg bg-brand-orange hover:bg-brand-orangeHover text-white font-semibold text-base transition-colors"
          >
            <Wand2 size={20} />
            Create Your Ringtone
            <ArrowRight size={18} />
          </Link>
          <Link
            href="/library"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-lg border border-bg-border hover:border-brand-orange text-brand-white font-semibold text-base transition-colors"
          >
            Browse Library
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="space-y-8">
        <h2 className="text-2xl font-bold text-brand-white text-center">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { icon: '🎨', step: '1', title: 'Describe', desc: 'Choose a genre and describe the vibe of your ringtone in plain language.' },
            { icon: '⚡', step: '2', title: 'Generate', desc: 'Our AI composes a unique ringtone based on your description in about a minute.' },
            { icon: '📱', step: '3', title: 'Download', desc: 'Download the MP3 and set it as your ringtone on any device.' },
          ].map(item => (
            <div key={item.step} className="bg-bg-panel border border-bg-border rounded-xl p-6 text-center space-y-3">
              <div className="text-4xl">{item.icon}</div>
              <div className="text-brand-orange text-xs font-bold uppercase tracking-widest">Step {item.step}</div>
              <h3 className="text-brand-white font-semibold text-lg">{item.title}</h3>
              <p className="text-brand-text text-sm">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Genre grid */}
      {genres.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-brand-white">Browse by Genre</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {genres.map(genre => (
              <Link
                key={genre.id}
                href={`/generate?genre=${genre.id}`}
                className="flex flex-col items-center gap-2 p-4 bg-bg-panel border border-bg-border rounded-xl hover:border-brand-orange hover:bg-brand-orange/5 transition-all duration-150 text-center group"
              >
                <span className="text-2xl">{genre.icon || GENRE_ICONS[genre.id] || '🎵'}</span>
                <span className="text-sm font-medium text-brand-white group-hover:text-brand-orange transition-colors">
                  {genre.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent ringtones */}
      {ringtones.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-brand-white">Recent Creations</h2>
            <Link href="/library" className="text-sm text-brand-orange hover:text-brand-orangeHover transition-colors flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ringtones.map(rt => (
              <RingtoneCard key={rt.id} ringtone={rt} />
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="bg-bg-panel border border-bg-border rounded-2xl p-8 sm:p-12 text-center space-y-5">
        <h2 className="text-3xl font-bold text-brand-white">Ready to create your ringtone?</h2>
        <p className="text-brand-text">It&apos;s free. No account required. Generate and download in under 2 minutes.</p>
        <Link
          href="/generate"
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-lg bg-brand-orange hover:bg-brand-orangeHover text-white font-semibold text-base transition-colors"
        >
          <Wand2 size={20} />
          Start Creating
        </Link>
        <div className="flex items-center justify-center gap-6 pt-2 text-xs text-brand-text">
          <span className="flex items-center gap-1"><Download size={12} /> Free downloads</span>
          <span className="flex items-center gap-1"><Zap size={12} /> AI-generated</span>
          <span className="flex items-center gap-1">📱 Works on all devices</span>
        </div>
      </section>
    </div>
  )
}
