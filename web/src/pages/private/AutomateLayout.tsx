import SideNavbar from "@/components/nav/SideNavbar";
import TopNavbar from "@/components/nav/TopNavbar";
import EmergencyStreamDrawer from "@/components/streams/EmergencyStreamDrawer";
import { Outlet } from "react-router-dom";
import CallProvider from "@/components/calls/CallProvider";

function SecureLayout() {
  return (
    <CallProvider>
    <div className="max-w-screen max-h-screen w-screen h-screen overflow-hidden flex">
      <SideNavbar />
      <div className="flex min-w-0 grow flex-col">
        <TopNavbar />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
        <EmergencyStreamDrawer />
      </div>
    </div>
    </CallProvider>
  );
}

export default SecureLayout;
