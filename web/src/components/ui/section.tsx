import { cn } from "@/lib/utils"

export default function Section({
  children,
  className,
  containerClassName,
  showIntersections,
}: {
  children: React.ReactNode
  className?: string
  containerClassName?: string
  showIntersections?: boolean
}) {
  return (
    <section className={cn("relative border-t border-border", className)}>
      {showIntersections ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
          <div className="w-full max-w-7xl relative">
            <div className="absolute left-0 top-0 size-2 bg-foreground -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute right-0 top-0 size-2 bg-foreground translate-x-1/2 -translate-y-1/2" />
          </div>
        </div>
      ) : null}
      <div className={cn("max-w-7xl mx-auto px-6 py-28", containerClassName)}>
        {children}
      </div>
    </section>
  )
}