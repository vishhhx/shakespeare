import { useMemo } from "react";
import { Dimensions, Text, TouchableOpacity, View, useColorScheme } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeSphereColors } from "../constants/colors";

type UserRole = "public" | "volunteer" | "responder" | "authority";

interface CustomTabBarProps extends BottomTabBarProps {
  role?: UserRole;
}

export default function CustomTabBar({
  state,
  descriptors,
  navigation,
  role = "public",
}: CustomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const windowWidth = Dimensions.get("window").width;

  const allowedRouteNames = useMemo(() => {
    if (role === "responder" || role === "authority") {
      return new Set(["dashboard", "incidents", "profile"]);
    }

    if (role === "volunteer") {
      return new Set(["volunteer-home", "volunteer-map", "volunteer-tasks", "profile"]);
    }

    return new Set(["home", "map", "safety-alerts", "profile"]);
  }, [role]);

  const visibleRoutes = state.routes.filter((route) => allowedRouteNames.has(route.name));
  const tabWidth = (windowWidth - 24) / Math.max(visibleRoutes.length, 1);

  const colorSchemeGradients = useMemo(
    () => [
      { primary: SafeSphereColors.primary.main, accent: SafeSphereColors.primary.dark },
      { primary: SafeSphereColors.success.main, accent: SafeSphereColors.success.dark },
      { primary: SafeSphereColors.emergency.main, accent: SafeSphereColors.emergency.dark },
      { primary: SafeSphereColors.primary.light, accent: SafeSphereColors.primary.main },
      { primary: SafeSphereColors.info.main, accent: SafeSphereColors.primary.main },
    ],
    []
  );

  const bgColor = colorScheme === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.7)";
  const borderColor = colorScheme === "dark"
    ? SafeSphereColors.text.disabled
    : SafeSphereColors.background.mediumGray;

  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom || 10 }}>
      <BlurView
        intensity={85}
        tint={colorScheme === "dark" ? "dark" : "light"}
        style={{ overflow: "hidden", borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      >
        <View
          className="flex-row items-center justify-around border-t px-3 py-2"
          style={{
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 10),
            backgroundColor: bgColor,
            borderTopColor: borderColor,
            borderTopWidth: 1,
          }}
        >
          {visibleRoutes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.routes[state.index]?.key === route.key;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: "tabLongPress",
                target: route.key,
              });
            };

            const colorInfo = colorSchemeGradients[index % colorSchemeGradients.length];
            const color = isFocused ? colorInfo.primary : SafeSphereColors.text.tertiary;

            const icon = options.tabBarIcon?.({
              color,
              size: 24,
              focused: isFocused,
            });

            return (
              <TouchableOpacity
                key={route.key}
                onPress={onPress}
                onLongPress={onLongPress}
                className="flex-1 items-center justify-center py-2"
                style={{ width: tabWidth }}
                activeOpacity={0.7}
              >
                <View className="items-center gap-1">
                  <View
                    className={`items-center justify-center rounded-2xl ${
                      isFocused ? "border-2" : "border-0"
                    }`}
                    style={{
                      width: 42,
                      height: 42,
                      backgroundColor: isFocused
                        ? SafeSphereColors.primary.pale
                        : "transparent",
                      borderColor: color,
                    }}
                  >
                    {icon}
                  </View>

                  <Text
                    className={`text-xs font-semibold leading-3 ${
                      isFocused
                        ? "text-gray-900 dark:text-white"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                    numberOfLines={1}
                    style={{
                      color: isFocused
                        ? SafeSphereColors.text.main
                        : SafeSphereColors.text.secondary,
                      fontSize: 10,
                    }}
                  >
                    {options.title ?? route.name}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}
