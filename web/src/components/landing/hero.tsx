import Section from "../ui/section"
import { Button } from "@/components/ui/button"
import { motion } from "motion/react"
import { Highlight } from "../ui/hero-highlight"
export default function Hero() {
  return (
    <Section className="border-t-0">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mx-auto max-w-3xl text-center font-sans"
      >
        <p className="text-sm text-destructive mb-4">
          For fast moving engineering teams.
        </p>

        <h1 className="text-6xl font-light tracking-tight leading-tight">
          Manage and simulate
          <br />
          agentic   <Highlight className="text-distractive">
   workflows 
        </Highlight>
        </h1>

        <p className="mt-6 text-muted-foreground">
          We empower developers and technical teams to create,
          simulate and manage AI-driven workflows visually
        </p>

        <div className="flex justify-center gap-4 mt-8">
          <Button size="lg" variant="outline">
            View pricing
          </Button>
        </div>

        <div className="mt-10 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <span aria-label="5 star rating">★★★★★</span>
          <span aria-hidden="true">|</span>
          <span>
            Innovative AI solution 2025 by <span className="text-foreground font-normal">Gartner</span>.
          </span>
        </div>

      </motion.div>
    </Section>
  )
}