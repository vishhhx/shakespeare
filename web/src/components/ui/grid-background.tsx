export default function GridBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">

      {/* vertical layout grid */}
      <div className="absolute inset-0 flex justify-center">
        <div className="w-full max-w-7xl h-full border-l border-r border-foreground/5 dark:border-foreground/10" />
      </div>

    </div>
  )
}