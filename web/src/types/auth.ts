export interface User {
  _id: string;
  name: string;
  email: string;
  role?: "public" | "volunteer" | "responder" | "authority" | "controller-center";
  token?: string;
  isVerified?: boolean;
  isverified?: boolean;
  isprofileComplete?: boolean;
  avatarUrl?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  authData: User | null;
}
