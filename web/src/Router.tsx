import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
} from "react-router-dom";
import App from "./App";
import LandingPage from "./pages/public/Authentication/LandingPage";
import AuthenticationLayout from "./pages/public/Authentication/AuthenticationLayout";
import Login from "./pages/public/Authentication/Login";
import SecureLayout from "./pages/private/AutomateLayout";
import Overview from "./pages/private/Overview";
import AddAuthority from "./pages/private/AddAuthority";
import ProfileSettings from "./pages/private/ProfileSettings";
import AuthorityProfileCompletion from "./pages/private/AuthorityProfileCompletion";
import EmergencyDetails from "./pages/private/EmergencyDetails";
import RequireAuth from "./components/auth/RequireAuth";


const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<App/>}>
        <Route path="/landing" element={<LandingPage />} />
        <Route element={<AuthenticationLayout />}>
          <Route path="/login" element={<Login />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<SecureLayout/>}>
            <Route path="overview" element={<Overview />} />
            <Route path="emergency/:emergencyId" element={<EmergencyDetails />} />
            <Route path="add-authority" element={<AddAuthority />} />
            <Route path="authority-profile/:userId" element={<AuthorityProfileCompletion />} />
            <Route path="settings/:section" element={<ProfileSettings />} />
          </Route>
        </Route>
      </Route>
    </>
  )
);

export default router;
