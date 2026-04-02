



import Hero from "../../../components/landing/hero"
import LogoGrid from "../../../components/landing/logo"
import GridBackground from "@/components/ui/grid-background"
import Navbar from "@/components/landing/navbar"
import IntegrationsBento from "@/components/landing/integrations-bento"

function LandingPage() {
 return (
    <div className="relative bg-background text-foreground">

      <GridBackground />

      <div className="relative z-10 pt-16">
        <Navbar />

        <Hero />

        <IntegrationsBento />

        <LogoGrid />
      </div>

    </div>
  )
}

export default LandingPage