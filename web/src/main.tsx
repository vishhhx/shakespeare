import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { RouterProvider } from "react-router-dom";


import "./index.css";

import router from "./Router";
import { Provider } from "react-redux";
import { store } from "./store/store";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "./components/theme-provider";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider defaultTheme="system" storageKey="theam">
        <RouterProvider router={router} />
        <Toaster />
      </ThemeProvider>
    </Provider>
  </StrictMode>
);
