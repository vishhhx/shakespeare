import { Outlet } from "react-router-dom";
import SideBord from "../../../components/auth/SideBord";

function AuthenticationLayout() {
  return (
    <div className="flex min-h-screen w-screen bg-gray-100 dark:bg-black">
      <div className="w-full lg:w-1/2">
        <Outlet />
      </div>

      <div className="hidden lg:flex lg:w-1/2">
        <SideBord />
      </div>
    </div>
  );
}

export default AuthenticationLayout;
