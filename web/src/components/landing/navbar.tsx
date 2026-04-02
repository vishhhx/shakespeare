import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { Moon, Sun } from "lucide-react"
import * as React from "react"
import { motion } from "motion/react"
import { Link } from "react-router-dom"

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">(
    "light"
  )

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

    const computeResolved = () => {
      const nextResolved = theme === "system" ? (mediaQuery.matches ? "dark" : "light") : theme
      setResolvedTheme(nextResolved)
    }

    computeResolved()
    mediaQuery.addEventListener("change", computeResolved)
    return () => {
      mediaQuery.removeEventListener("change", computeResolved)
    }
  }, [theme])

  const isDark = resolvedTheme === "dark"
  const Icon = isDark ? Sun : Moon

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Icon />
    </Button>
  )
}

export default function Navbar() {
  const [isFloating, setIsFloating] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => {
      setIsFloating(window.scrollY > 16)
    }

    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={
        "fixed inset-x-0 top-0 z-50 " +
        (isFloating ? "py-3" : "border-b border-border")
      }
    >

      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className={
            "grid grid-cols-3 items-center transition-all " +
            (isFloating
              ? "h-14 rounded-2xl border border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
              : "h-16")
          }
        >

        <div className="flex items-center gap-2 font-semibold justify-self-start pl-4">
          <div className="w-2.5 h-2.5 bg-foreground rounded-full" />
          Notus
        </div>

        <nav className="hidden md:flex gap-8 text-sm text-muted-foreground justify-self-center">
          <a className="hover:text-foreground" href="#">Pricing</a>
          <a className="hover:text-foreground" href="#">About</a>
          <a className="hover:text-foreground" href="#">Careers</a>
          <a className="hover:text-foreground" href="#">Blog</a>
        </nav>

        <div className="flex items-center gap-1.5 justify-self-end pr-3">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link to="/register">Sign up</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/login">Log in</Link>
          </Button>
        </div>

        </motion.div>
      </div>

    </motion.header>
  )
}