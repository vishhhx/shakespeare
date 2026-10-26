import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { useContext } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AuthContext } from "../../context/authContext";

export default function HomeTab() {
  const { userDetails } = useContext(AuthContext);

  const userName = userDetails?.name;

  return (
    <View className="flex-1 bg-[#FFFBF8]">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ============================================================ */}
        {/* Header                                                       */}
        {/* ============================================================ */}

        <View className="flex-row items-center justify-between">
          <View></View>
        </View>

        {/* ============================================================ */}
        {/* Welcome                                                       */}
        {/* ============================================================ */}

        <View className="mt-8">
          <Text className="text-[24px] font-bold tracking-tight text-[#2A1B12]">
            {userName ? `Hi, ${userName}` : "Welcome back"}
          </Text>

          <Text className="mt-2 max-w-[330px] text-[14px] leading-6 text-[#725E50]">
            {userName
              ? "Stay prepared, stay connected, and stay safe."
              : "Your safety tools are ready when you need them."}
          </Text>
        </View>

        {/* ============================================================ */}
        {/* Emergency                                                     */}
        {/* ============================================================ */}

        <View
          className="mt-8 overflow-hidden rounded-2xl border p-5"
          style={{
            backgroundColor: "#FFFFFF",
            borderColor: "#F2D6C4",
          }}
        >
          <View className="flex-row items-start">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#FEF2F2]">
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color="#DC2626"
              />
            </View>

            <View className="ml-3 flex-1">
              <Text className="text-[16px] font-bold text-[#2A1B12]">
                Need help?
              </Text>

              <Text className="mt-1 text-[12px] leading-5 text-[#725E50]">
                Access emergency assistance and safety tools from one place.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => router.push("/(tabs)/emergency")}
            className="mt-5 h-[50px] flex-row items-center justify-center rounded-xl bg-[#DC2626]"
          >
            <Ionicons name="alert-circle-outline" size={19} color="#FFFFFF" />

            <Text className="ml-2 text-[14px] font-bold text-white">
              Open emergency
            </Text>
          </Pressable>
        </View>

        {/* ============================================================ */}
        {/* Quick actions                                                 */}
        {/* ============================================================ */}

        <View className="mt-8">
          <Text className="text-[17px] font-bold text-[#2A1B12]">
            Quick access
          </Text>

          <Text className="mt-1 text-[12px] text-[#9A887C]">
            Common safety tools
          </Text>
        </View>

        <View className="mt-4 overflow-hidden rounded-2xl border border-[#E8DED7] bg-white">
          {/* Profile */}

          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            className="flex-row items-center px-4 py-4"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#FFF4E8]">
              <Ionicons name="person-outline" size={19} color="#EA5B0C" />
            </View>

            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-semibold text-[#2A1B12]">
                My profile
              </Text>

              <Text className="mt-0.5 text-[11px] text-[#9A887C]">
                Medical information and contacts
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={17} color="#B7A79D" />
          </Pressable>

          <View className="ml-[68px] h-px bg-[#F1EAE5]" />

          {/* Emergency */}

          <Pressable
            onPress={() => router.push("/(tabs)/emergency")}
            className="flex-row items-center px-4 py-4"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#FEF2F2]">
              <Ionicons name="call-outline" size={19} color="#DC2626" />
            </View>

            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-semibold text-[#2A1B12]">
                Emergency contacts
              </Text>

              <Text className="mt-0.5 text-[11px] text-[#9A887C]">
                Get help quickly when it matters
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={17} color="#B7A79D" />
          </Pressable>
        </View>

        {/* ============================================================ */}
        {/* Safety status                                                 */}
        {/* ============================================================ */}

        <View className="mt-8">
          <Text className="text-[17px] font-bold text-[#2A1B12]">
            Safety status
          </Text>

          <View className="mt-3 flex-row items-center rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3.5">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-white">
              <Ionicons
                name="shield-checkmark-outline"
                size={17}
                color="#16A34A"
              />
            </View>

            <View className="ml-3 flex-1">
              <Text className="text-[13px] font-semibold text-[#2A1B12]">
                You’re all set
              </Text>

              <Text className="mt-0.5 text-[11px] text-[#725E50]">
                Your SafeSphere tools are available.
              </Text>
            </View>

            <View className="h-2 w-2 rounded-full bg-[#16A34A]" />
          </View>
        </View>

        {/* ============================================================ */}
        {/* Footer                                                        */}
        {/* ============================================================ */}

        <View className="mt-10 items-center">
          <View className="flex-row items-center">
            <Ionicons
              name="shield-checkmark-outline"
              size={13}
              color="#9A887C"
            />

            <Text className="ml-1.5 text-[10px] text-[#9A887C]">
              SafeSphere • Stay prepared. Stay safe.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
