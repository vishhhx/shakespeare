import Section from "@/components/ui/section"
import { cn } from "@/lib/utils"
import { Link2, Rocket, SquareDashedMousePointer } from "lucide-react"
import { motion } from "motion/react"

function BentoItem({
  title,
  description,
  icon: Icon,
  active,
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  active?: boolean
}) {
  return (
    <div
      className={cn(
        "px-6 py-6",
        active ? "bg-muted/40" : "bg-transparent",
        "transition-colors"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {description}
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewPanel() {
  return (
    <div className="h-full w-full rounded-xl border border-border bg-background overflow-hidden">
      <div className="h-12 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="size-2 rounded-full bg-muted-foreground/40" />
          <div className="size-2 rounded-full bg-muted-foreground/40" />
          <div className="size-2 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="text-xs text-muted-foreground">Preview</div>
      </div>

      <div className="p-6 grid grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="text-xs text-muted-foreground">Tasks</div>
          <div className="mt-4 space-y-3">
            <div className="h-3 w-5/6 rounded bg-muted" />
            <div className="h-3 w-4/6 rounded bg-muted" />
            <div className="h-3 w-3/6 rounded bg-muted" />
          </div>
          <div className="mt-6 text-xs text-muted-foreground leading-relaxed">
            Write the first and second rule of it using Claude and ChatGPT.
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/10 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Integrations</div>
            <div className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
              200
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <div className="text-sm">ChatGPT</div>
              <div className="text-[10px] rounded bg-muted px-2 py-1 text-muted-foreground">
                Connected
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <div className="text-sm">Claude 4 Opus</div>
              <div className="text-[10px] rounded bg-muted px-2 py-1 text-muted-foreground">
                Connected
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <div className="h-3 w-5/6 rounded bg-muted" />
              <div className="h-3 w-4/6 rounded bg-muted" />
              <div className="h-3 w-3/6 rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function IntegrationsBento() {
  return (
    <Section showIntersections containerClassName="py-20">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.35 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="text-center max-w-3xl mx-auto"
      >
        <p className="text-sm text-destructive">How it works</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight">
          Integrates easily
        </h2>
        <p className="mt-4 text-muted-foreground">
          We empower developers and technical teams to create, simulate, and
          manage AI-driven workflows visually
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mt-12 grid grid-cols-1 lg:grid-cols-2 border border-border rounded-2xl overflow-hidden bg-background"
      >
        <div className="divide-y divide-border">
          <BentoItem
            icon={SquareDashedMousePointer}
            title="Design your Workflow"
            description="A drag-and-drop interface to create, connect, and configure agents into logical workflows."
          />
          <BentoItem
            icon={Link2}
            title="Connect your Tools"
            description="Agents operate independently and coordinate tasks to complete all complex goals together."
            active
          />
          <BentoItem
            icon={Rocket}
            title="Deploy & Scale"
            description="Run agent workflows in a sandbox to preview behavior, debug logic, and test interactions."
          />
        </div>

        <div className="border-t border-border lg:border-t-0 lg:border-l border-border p-6 bg-muted/10">
          <PreviewPanel />
        </div>
      </motion.div>
    </Section>
  )
}
