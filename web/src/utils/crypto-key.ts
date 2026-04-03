type OpenFileHandle = {
  getFile: () => Promise<{
    text: () => Promise<string>;
  }>;
};

type OpenPickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<OpenFileHandle[]>;
};

type Writable = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};

type SaveFileHandle = {
  createWritable: () => Promise<Writable>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    startIn?: "desktop" | "documents" | "downloads";
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFileHandle>;
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const fromBase64 = (b64: string) =>
  Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));

export const getKeyFromUSB = async () => {
  const picker = (window as OpenPickerWindow).showOpenFilePicker;
  const parseSecureKey = (content: string) =>
    JSON.parse(content) as {
      type: string;
      encryptedPrivateKey: string;
    };

  if (picker) {
    const [handle] = await picker({
      multiple: false,
      types: [
        {
          description: "Secure Key",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const file = await handle.getFile();
    const content = await file.text();

    return parseSecureKey(content);
  }

  const file = await new Promise<File>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";

    input.onchange = () => {
      const selected = input.files?.[0];
      if (!selected) {
        reject(new Error("No key file selected"));
        return;
      }

      resolve(selected);
    };

    input.onerror = () => reject(new Error("Unable to open file picker"));
    input.click();
  });

  const content = await file.text();

  return parseSecureKey(content);
};

export const decryptPrivateKey = async (payload: string, password: string) => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const { encrypted, iv, salt } = JSON.parse(payload) as {
    encrypted: string;
    iv: string;
    salt: string;
  };

  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const key = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(iv),
    },
    key,
    fromBase64(encrypted),
  );

  return dec.decode(decryptedBuffer);
};

export const encryptPrivateKey = async (data: string, password: string) => {
  const enc = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const key = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(data),
  );

  return JSON.stringify({
    encrypted: toBase64(new Uint8Array(encryptedBuffer)),
    iv: toBase64(iv),
    salt: toBase64(salt),
  });
};

export const saveEncryptedKeyToUSB = async (
  encryptedPrivateKey: string,
  suggestedName = "secure-key.json",
) => {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  const serializedKey = JSON.stringify({
    type: "SecureKey",
    encryptedPrivateKey,
  });

  if (picker) {
    const handle = await picker({
      suggestedName,
      startIn: "documents",
      types: [
        {
          description: "Secure Key",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    const writable = await handle.createWritable();

    await writable.write(serializedKey);
    await writable.close();
    return;
  }

  const blob = new Blob([serializedKey], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
};