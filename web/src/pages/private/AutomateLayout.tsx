import SideNavbar from "@/components/nav/SideNavbar";
import TopNavbar from "@/components/nav/TopNavbar";
import { Outlet } from "react-router-dom";

function SecureLayout() {
  return (
    <div className="max-w-screen max-h-screen w-screen h-screen overflow-hidden flex">
      <SideNavbar />
      <div className="flex min-w-0 grow flex-col">
        <TopNavbar />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default SecureLayout;
