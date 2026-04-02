import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
} from "react-router-dom";
import App from "./App";
import LandingPage from "./pages/public/Authentication/LandingPage";
import AuthenticationLayout from "./pages/public/Authentication/AuthenticationLayout";
import Login from "./pages/public/Authentication/Login";
import SignIn from "./pages/public/Authentication/SignIn";
import SecureLayout from "./pages/private/AutomateLayout";
import TestPayments from "./pages/private/TestPayments";


const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<App/>}>
        <Route path="/landing" element={<LandingPage />} />
        <Route element={<AuthenticationLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<SignIn/>} />
        </Route>
        <Route path="/" element={<SecureLayout/>}>
          <Route path="test-paymets" element={<TestPayments />} />
          
        </Route>
      </Route>
    </>
  )
);

export default router;
