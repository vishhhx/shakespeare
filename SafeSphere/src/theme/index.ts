import { useColorScheme } from "react-native";
import { palettes, type Palette } from "./tokens";

export * from "./tokens";

export function useTheme(): { colors: Palette; scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { colors: palettes[scheme], scheme };
}
