import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, StyleSheet, Platform } from "react-native";

const COLORS = {
  background: "#FFFFFF",

  primary: "#FF7A1A",
  primarySoft: "#FFF4E8",

  emergency: "#DC2626",
  emergencySoft: "#FEF2F2",

  inactive: "#9A887C",
  border: "#E8DED7",
  text: "#2A1B12",
};

function TabBarBackground() {
  return <View style={styles.tabBarBackground} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,

        tabBarActiveTintColor: COLORS.primary,

        tabBarInactiveTintColor: COLORS.inactive,

        tabBarStyle: styles.tabBar,

        tabBarLabelStyle: styles.tabLabel,

        tabBarItemStyle: styles.tabItem,

        tabBarBackground: () => <TabBarBackground />,

        tabBarHideOnKeyboard: true,
      }}
    >
      {/* ================================================================ */}
      {/* HOME                                                             */}
      {/* ================================================================ */}

      <Tabs.Screen
        name="index"
        options={{
          title: "Home",

          tabBarIcon: ({ color, focused }) => (
            <View
              style={[
                styles.iconContainer,
                focused && styles.activeIconContainer,
              ]}
            >
              <Ionicons
                name={focused ? "home" : "home-outline"}
                color={focused ? COLORS.primary : color}
                size={21}
              />
            </View>
          ),
        }}
      />

      {/* ================================================================ */}
      {/* EMERGENCY                                                        */}
      {/* ================================================================ */}

      <Tabs.Screen
        name="emergency"
        options={{
          title: "Emergency",

          tabBarActiveTintColor: COLORS.emergency,

          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.iconContainer,
                focused ? styles.emergencyActive : styles.emergencyInactive,
              ]}
            >
              <Ionicons
                name={focused ? "alert-circle" : "alert-circle-outline"}
                color={focused ? "#FFFFFF" : COLORS.emergency}
                size={21}
              />
            </View>
          ),
        }}
      />

      {/* ================================================================ */}
      {/* PROFILE                                                          */}
      {/* ================================================================ */}

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",

          tabBarIcon: ({ color, focused }) => (
            <View
              style={[
                styles.iconContainer,
                focused && styles.activeIconContainer,
              ]}
            >
              <Ionicons
                name={focused ? "person" : "person-outline"}
                color={focused ? COLORS.primary : color}
                size={21}
              />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  /* ------------------------------------------------------------------ */
  /* Tab bar                                                            */
  /* ------------------------------------------------------------------ */

  tabBar: {
    position: "absolute",

    height: Platform.OS === "ios" ? 82 : 68,

    paddingTop: 7,

    paddingBottom: Platform.OS === "ios" ? 21 : 8,

    borderTopWidth: 0,

    backgroundColor: "transparent",

    elevation: 0,

    shadowOpacity: 0,
  },

  tabBarBackground: {
    position: "absolute",

    top: 0,
    left: 0,
    right: 0,
    bottom: 0,

    backgroundColor: COLORS.background,

    borderTopWidth: 1,

    borderTopColor: COLORS.border,

    shadowColor: "#000",

    shadowOffset: {
      width: 0,
      height: -2,
    },

    shadowOpacity: 0.04,

    shadowRadius: 8,

    elevation: 8,
  },

  /* ------------------------------------------------------------------ */
  /* Labels                                                             */
  /* ------------------------------------------------------------------ */

  tabLabel: {
    fontSize: 10,

    fontWeight: "600",

    letterSpacing: 0,

    marginTop: 2,
  },

  tabItem: {
    paddingTop: 3,
  },

  /* ------------------------------------------------------------------ */
  /* Icon containers                                                     */
  /* ------------------------------------------------------------------ */

  iconContainer: {
    width: 34,
    height: 30,

    alignItems: "center",
    justifyContent: "center",

    borderRadius: 9,
  },

  activeIconContainer: {
    backgroundColor: COLORS.primarySoft,
  },

  /* ------------------------------------------------------------------ */
  /* Emergency                                                          */
  /* ------------------------------------------------------------------ */

  emergencyActive: {
    backgroundColor: COLORS.emergency,

    width: 36,
    height: 32,

    borderRadius: 10,
  },

  emergencyInactive: {
    backgroundColor: COLORS.emergencySoft,

    width: 34,
    height: 30,

    borderRadius: 9,
  },
});
