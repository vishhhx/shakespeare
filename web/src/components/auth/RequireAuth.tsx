import { useAppSelector } from "@/store/hooks";
import { Navigate, Outlet } from "react-router-dom";

function RequireAuth() {
  const authData = useAppSelector((state) => state.auth.authData);

  if (!authData?.token && !authData?.email) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default RequireAuth;