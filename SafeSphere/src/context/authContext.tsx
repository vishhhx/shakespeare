import { createContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";







export interface UserDetails {
  userId: string;
  phoneNumber: string;
  name: string;
  role: string;
  isVerified: boolean;
  avatarUrl?: string;
  isprofileComplete: boolean;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  userDetails: UserDetails | null;
  authToken: string | null;


  setUserDetails: (user: UserDetails | null) => void;
  setIsAuthenticated: (value: boolean) => void;
  saveAuth: (data: { user: UserDetails; token?: string }) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  logout: async () => {},
  userDetails: null,
  authToken: null,
  setUserDetails: () => {},
  setIsAuthenticated: () => {},
  saveAuth: async () => {},
});

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);


  const persistUserDetails = async (user: UserDetails | null) => {
    try {
      if (user) {
        await AsyncStorage.setItem("userDetails", JSON.stringify(user));
      } else {
        await AsyncStorage.removeItem("userDetails");
      }
    } catch (error) {
      console.error("Error updating user details:", error);
    }
  };

  const setAuthUserDetails = (user: UserDetails | null) => {
    setUserDetails(user);
    void persistUserDetails(user);
  };




  const logout = async () => {
    setIsAuthenticated(false);
    setUserDetails(null);
    setAuthToken(null);

    try {
      await AsyncStorage.multiRemove([
        "userDetails",
        "authToken",
        "deliveryPartner",
      ]);
     
    } catch (error) {
      console.error("Error clearing auth storage:", error);
    }
  };

  const saveAuth = async ({
    user,
    token,
  }: {
    user: UserDetails;
    token?: string;
  }) => {
    try {
      setUserDetails(user);
      await persistUserDetails(user);
      if (token) {
        await AsyncStorage.setItem("authToken", token);
        setAuthToken(token);
      }
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Error saving auth:", error);
    }
  };

  useEffect(() => {
    const getUserDetails = async () => {
      try {
        const storedToken = await AsyncStorage.getItem("authToken");
        const userData = await AsyncStorage.getItem("userDetails");
        if (storedToken) {
          setAuthToken(storedToken);
        }
        if (userData) {
          const parsed: UserDetails = JSON.parse(userData);
          setUserDetails(parsed);
          setIsAuthenticated(Boolean(storedToken));
        } else if (!storedToken) {
          setIsAuthenticated(false);
        }

      
      } catch (error) {
        console.error("Error retrieving user:", error);
        setIsAuthenticated(false);
        setUserDetails(null);
        setAuthToken(null);

      }
    };

    getUserDetails();
  }, []);



  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        logout,
        userDetails,
        authToken,

        setUserDetails: setAuthUserDetails,
        setIsAuthenticated,
        saveAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;