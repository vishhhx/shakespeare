import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { View, Text, Pressable, Image, Alert } from "react-native";
import { api } from "../lib/api";
import { getS3ReadUrl } from "../lib/api";

type Props = {
  userId?: string;
  initialImageUrl?: string;
  onUploadComplete?: (key: string) => void;
};

export default function ProfileImagePicker({ userId, initialImageUrl, onUploadComplete }: Props) {
  const [image, setImage] = useState<string | null>(initialImageUrl ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const resolveInitialImage = async () => {
      if (!initialImageUrl) {
        setImage(null);
        return;
      }

      if (/^https?:\/\//i.test(initialImageUrl)) {
        setImage(initialImageUrl);
        return;
      }

      try {
        const { url } = await getS3ReadUrl(initialImageUrl);
        setImage(url);
      } catch (error) {
        console.warn("Unable to resolve signed profile image URL:", error);
        setImage(null);
      }
    };

    void resolveInitialImage();
  }, [initialImageUrl]);

  const uploadToS3 = async (uri: string) => {
    try {
      setLoading(true);

      if (!userId) {
        Alert.alert("Upload failed", "User session missing. Please login again.");
        return;
      }

      const fileName = `avatar/${String(userId)}.jpg`;

      const res = await api.post("/public-user/upload-url", {
        key: fileName,
        contentType: "image/jpeg",
        bucket: "profile",
      });

      const { url } = res.data;

      const file = await fetch(uri);
      const blob = await file.blob();

      await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
        },
        body: blob,
      });

      const signed = await getS3ReadUrl(fileName);
      setImage(signed.url);
      onUploadComplete?.(fileName);
    } catch (error) {
      console.error(error);
      Alert.alert("Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Camera permission required");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setImage(uri);
      void uploadToS3(uri);
    }
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Gallery permission required");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setImage(uri);
      void uploadToS3(uri);
    }
  };

  const openOptions = () => {
    Alert.alert("Select Image", "", [
      { text: "Camera", onPress: takePhoto },
      { text: "Gallery", onPress: pickImage },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  return (
    <View className="items-center">
      <Pressable onPress={openOptions}>
        <Image
          source={{
            uri:
              image ||
              "https://cdn-icons-png.flaticon.com/512/149/149071.png",
          }}
          className="h-32 w-32 rounded-full"
        />
      </Pressable>

      {loading && <Text className="mt-2 text-blue-500">Uploading...</Text>}
    </View>
  );
}