import { Outlet } from "react-router-dom";

import { useEffect, useState } from "react";
import { useAppDispatch } from "./store/hooks";
import { AuthServices } from "./services";
import { addUser } from "./store/slices/authSlice";
import { LoaderOne } from "./components/ui/loader";
import { axiosInstance } from "./utils";
import { setSessions } from "./store/slices/sessionSlice";

function App() {

  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState(true);
 
  
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const storedAuth = localStorage.getItem("safesphere-auth");
        if (storedAuth) {
          dispatch(addUser(JSON.parse(storedAuth)));
        } else {
          const response = await AuthServices.getCurrentUser().catch(() => null);
          if (response) {
            dispatch(addUser(response));
          }
        }

        try {
          const { data } = await axiosInstance.get("/session/get-all-sessions");
          dispatch(setSessions(data.data));
        } catch {
          // Session endpoint may be unavailable in some environments.
          dispatch(setSessions([]));
        }
      } catch (error) {
        console.error("Failed to fetch user", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [dispatch]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <LoaderOne />;
      </div>
    );
  }

  return (
    <>
      <Outlet />
    </>
  );
}

export default App;
