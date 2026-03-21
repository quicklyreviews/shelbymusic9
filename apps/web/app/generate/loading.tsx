export default function GenerateLoading() {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-56 bg-bg-panel rounded-lg animate-pulse" />
        <div className="h-4 w-72 bg-bg-panel rounded animate-pulse" />
      </div>

      <div className="space-y-5">
        {/* Genre grid skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-12 bg-bg-panel rounded animate-pulse" />
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 bg-bg-panel rounded-xl animate-pulse" />
            ))}
          </div>
        </div>

        {/* Prompt skeleton */}
        <div className="space-y-1.5">
          <div className="h-4 w-40 bg-bg-panel rounded animate-pulse" />
          <div className="h-24 w-full bg-bg-panel rounded-lg animate-pulse" />
        </div>

        {/* Duration skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-16 bg-bg-panel rounded animate-pulse" />
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex-1 h-10 bg-bg-panel rounded-lg animate-pulse" />
            ))}
          </div>
        </div>

        {/* Button skeleton */}
        <div className="h-12 w-full bg-bg-panel rounded-lg animate-pulse" />
      </div>
    </div>
  )
}
