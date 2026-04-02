import Section from "../ui/section"
import { motion } from "motion/react"

const logos = [
  "incident.io",
  "ARCH",
  "Hippocratic",
  "Primer",
  "Bridge",
  "Modal",
  "Replicate",
  "Granola",
]

export default function LogoGrid() {
  return (
    <Section showIntersections>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <p className="text-center text-xs text-muted-foreground mb-12">
          TRUSTED BY FAST GROWING STARTUPS
        </p>

        <div className="grid grid-cols-4 border border-border">
          {logos.map((logo) => (
            <div
              key={logo}
              className="h-24 flex items-center justify-center border-r border-b border-border text-sm"
            >
              {logo}
            </div>
          ))}
        </div>
      </motion.div>

    </Section>
  )
}