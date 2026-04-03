import { useNavigate } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowUpCircle,
  HelpCircle,
  LogOut,
  Plug,
  Settings,
} from "lucide-react";
import { removeUser } from "@/store/slices/authSlice";
import { Button } from "@/components/ui/button";
import { useSocket } from "@/context/socketContext";

const menuItems = [
  {
    icon: ArrowUpCircle,
    name: "Upgrade",
    href: "/settings/general",
  },
  {
    icon: Settings,
    name: "Settings",
    href: "/settings/general",
  },
  {
    icon: Plug,
    name: "Integrations",
    href: "/settings/integrations",
  },
  {
    icon: HelpCircle,
    name: "Help",
    href: "/help",
  },
  {
    icon: LogOut,
    name: "Logout",
    href: "/logout",
  },
];

export default function TopNavbar() {
  const user = useAppSelector((state) => state.auth.authData);
  const dispatch = useAppDispatch();
  const { socket } = useSocket();
  const navigate = useNavigate();

  const handleMenuClick = (name: string, href: string) => {
    if (name.toLowerCase() === "logout") {
      socket?.disconnect();
      localStorage.removeItem("safesphere-auth");
      dispatch(removeUser());
      navigate("/login");
      return;
    }

    navigate(href);
  };

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-sm font-semibold text-foreground">Dashboard</h1>
      </div>

      <div className="flex w-full max-w-xl items-center">
        <Input placeholder="Search for anything..." className="h-9" />
      </div>

      <div className="flex items-center gap-3">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex size-9 items-center justify-center overflow-hidden rounded-full border bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
              aria-label="Open user menu"
            >
              <img
                src={user?.avatarUrl}
                alt={user?.name}
                className="size-9 rounded-full object-cover"
              />
            </button>
          </PopoverTrigger>

          <PopoverContent className="w-64 p-2" align="end" side="bottom" sideOffset={8}>
            <div className="space-y-1">
              <div className="px-3 py-2 mb-2">
                <p className="text-sm font-medium text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>

              <div className="border-t my-2" />

              {menuItems.map((item) => {
                const Icon = item.icon;
                const isLogout = item.name.toLowerCase() === "logout";

                return (
                  <Button
                    key={item.name}
                    type="button"
                    variant="ghost"
                    onClick={() => handleMenuClick(item.name, item.href)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isLogout
                        ? "text-red-400 hover:bg-destructive/10"
                        : "text-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="capitalize">{item.name}</span>
                  </Button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
