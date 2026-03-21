export default function LibraryLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-bg-panel rounded-lg animate-pulse" />
          <div className="h-4 w-32 bg-bg-panel rounded animate-pulse" />
        </div>
        <div className="h-10 w-36 bg-bg-panel rounded-lg animate-pulse" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-8 w-20 bg-bg-panel rounded-lg animate-pulse" />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-44 bg-bg-panel rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  )
}
