import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { getS3UploadUrl } from "../lib/api";

export type UploadedDocument = {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  uploadedAt: string;
};

/**
 * Hook to handle document picking (camera or gallery), S3 upload, and file management
 */
export const useDocumentPicker = () => {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const pickDocument = async () => {
    try {
      setError(null);
      
      // Request camera and media library permissions
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!cameraPermission.granted && !mediaPermission.granted) {
        setError("Camera and media library permissions are required");
        return null;
      }

      // Let user choose between camera or gallery
      // For now, we'll use gallery as it's safer for documents
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (result.canceled || !result.assets[0]) {
        return null;
      }

      const asset = result.assets[0];

      // Get file size - for mobile, we'll estimate
      let fileSize = 0;
      // Since size might not be available, estimate based on quality
      if (asset.fileSize) {
        fileSize = asset.fileSize;
      } else {
        // Rough estimate: ~200KB per image
        fileSize = 200 * 1024;
      }

      // Validate file size (max 10MB)
      if (fileSize > 10 * 1024 * 1024) {
        setError("File size must be less than 10MB");
        return null;
      }

      const fileName = asset.fileName || `document_${Date.now()}.jpg`;

      return {
        uri: asset.uri,
        name: fileName,
        type: asset.type === 'image' ? (asset.mimeType || "image/jpeg") : "image/jpeg",
        size: fileSize,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to pick document";
      setError(message);
      return null;
    }
  };

  const uploadDocument = async (file: {
    uri: string;
    name: string;
    type: string;
    size: number;
  }, userId: string) => {
    setUploading(true);
    setError(null);
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      // Get presigned URL
      const safeName = file.name.replace(/\s+/g, "-");
      const key = `volunteer-docs/${userId}/${Date.now()}-${safeName}`;

      const uploadUrl = await getS3UploadUrl({
        key,
        contentType: file.type,
        bucket: "profile",
      });

      setUploadProgress((prev) => ({ ...prev, [fileId]: 25 }));

      try {
        const fileResponse = await fetch(file.uri);
        const blob = await fileResponse.blob();

        const response = await fetch(uploadUrl.url, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
          },
          body: blob,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }
      } catch (uploadErr) {
        throw uploadErr;
      }

      setUploadProgress((prev) => ({ ...prev, [fileId]: 100 }));

      // Create document record
      const newDocument: UploadedDocument = {
        id: fileId,
        name: file.name,
        url: key,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
      };

      setDocuments((prev) => [...prev, newDocument]);
      
      // Clear progress after a short delay
      setTimeout(() => {
        setUploadProgress((prev) => {
          const updated = { ...prev };
          delete updated[fileId];
          return updated;
        });
      }, 1000);

      return newDocument;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload document";
      setError(message);
      setUploadProgress((prev) => {
        const updated = { ...prev };
        delete updated[fileId];
        return updated;
      });
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const handleAddDocument = async (userId?: string) => {
    if (!userId) {
      setError("User session missing. Please login again.");
      return;
    }

    const file = await pickDocument();
    if (file) {
      try {
        await uploadDocument(file, userId);
      } catch (err) {
        console.error("Document upload failed:", err);
      }
    }
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  };

  return {
    documents,
    uploading,
    uploadProgress,
    error,
    handleAddDocument,
    removeDocument,
    setDocuments,
  };
};
