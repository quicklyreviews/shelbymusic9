import type { Metadata } from 'next'
import Link from 'next/link'
import { getAllGenres, getRingtonesByGenre } from '@/lib/storage'
import { RingtoneCard } from '@/components/RingtoneCard'
import { Wand2 } from 'lucide-react'
import type { Genre, Ringtone } from '@/types'

export const revalidate = 60 // ISR: refresh every 60s

export const metadata: Metadata = {
  title: 'Ringtone Library',
  description: 'Browse AI-generated ringtones created by the community. Play, download, or get inspired for your own creation.',
}

async function getLibraryData(genre?: string) {
  try {
    const [ringtones, allGenres] = await Promise.all([
      getRingtonesByGenre(genre, 48),
      getAllGenres(),
    ])
    return { ringtones, genres: allGenres.map(g => ({ id: g.id, name: g.name, icon: g.icon })) }
  } catch {
    return { ringtones: [] as Ringtone[], genres: [] as Pick<Genre, 'id' | 'name' | 'icon'>[] }
  }
}

interface LibraryPageProps {
  searchParams: { genre?: string }
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const activeGenre = searchParams.genre
  const { ringtones, genres } = await getLibraryData(activeGenre)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-brand-white">Ringtone Library</h1>
          <p className="text-brand-text mt-1">
            {ringtones.length} AI-generated ringtones
          </p>
        </div>
        <Link
          href="/generate"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-orange hover:bg-brand-orangeHover text-white font-semibold text-sm transition-colors"
        >
          <Wand2 size={16} />
          Create Your Own
        </Link>
      </div>

      {/* Genre filter */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/library"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              !activeGenre
                ? 'bg-brand-orange border-brand-orange text-white'
                : 'bg-bg-panel border-bg-border text-brand-text hover:border-brand-orange hover:text-brand-white'
            }`}
          >
            All
          </Link>
          {genres.map(g => (
            <Link
              key={g.id}
              href={`/library?genre=${g.id}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                activeGenre === g.id
                  ? 'bg-brand-orange border-brand-orange text-white'
                  : 'bg-bg-panel border-bg-border text-brand-text hover:border-brand-orange hover:text-brand-white'
              }`}
            >
              {g.icon && <span>{g.icon}</span>}
              {g.name}
            </Link>
          ))}
        </div>
      )}

      {/* Grid */}
      {ringtones.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {ringtones.map(rt => (
            <RingtoneCard key={rt.id} ringtone={rt} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 space-y-4">
          <p className="text-4xl">🎵</p>
          <p className="text-brand-white font-semibold">No ringtones yet</p>
          <p className="text-brand-text text-sm">
            {activeGenre ? `No ${activeGenre} ringtones found. ` : ''}
            Be the first to create one!
          </p>
          <Link
            href={`/generate${activeGenre ? `?genre=${activeGenre}` : ''}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-orange hover:bg-brand-orangeHover text-white font-semibold text-sm transition-colors"
          >
            <Wand2 size={16} />
            Generate Now
          </Link>
        </div>
      )}
    </div>
  )
}
