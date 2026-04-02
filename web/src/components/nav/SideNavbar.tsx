import { cn } from "@/lib/utils";
import { useEffect, useState, type ElementType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import { useAppSelector } from "@/store/hooks";
import { Button } from "../ui/button";
import {
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Plus,
} from "lucide-react";
interface NavItemData {
  name: string;
  icon: ElementType;
  href: string;
}

const SideCollapse = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
      <path d="M9 4v16" />
      <path d="M15 10l-2 2l2 2" />
    </svg>
  );
};

const SideExpand = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
      <path d="M9 4v16" />
      <path d="M14 10l2 2l-2 2" />
    </svg>
  );
};
const navItems: NavItemData[] = [
  {
    name: "Create",
    icon: Plus,
    href: "/new",
  },
  {
    name: "Messages",
    icon: MessageSquare,
    href: "/chats",
  },
  {
    name: "Workflows",
    icon: GitBranch,
    href: "/Workflow",
  },
    {
    name: "Hub",
    icon: LayoutGrid,
    href: "/hub",
  },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeItem, setActiveItem] = useState<string>(location.pathname);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const sessions = useAppSelector((state) => state.session.sessions);
  // const user = useAppSelector((state) => state.auth.authData);
  useEffect(() => {
    setActiveItem(location.pathname);
  }, [location.pathname]);

  const handleNavigate = (href: string) => {
    navigate(href);
    setActiveItem(href);
  };

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-background text-foreground transition-all duration-300 ease-in-out h-screen shadow-sm",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-between px-4 py-2">
        <div
          className={cn(
            "transition-all duration-300 overflow-hidden",
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          )}
        >
          <Logo size={18} showText={true} variant="compact" />
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "p-2 rounded-lg transition-all duration-200 hover:bg-accent/80 active:scale-95 cursor-pointer",
            collapsed && "mx-auto"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <SideExpand /> : <SideCollapse />}
        </button>
      </div>

      <div className="flex-1 p-2 scrollbar-thin">
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.href;

            return (
              <button
                key={item.href}
                onClick={() => handleNavigate(item.href)}
                className={cn(
                  "flex items-center w-full rounded-lg transition-colors duration-200 active:scale-[0.99] outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  collapsed
                    ? "justify-center p-2.5"
                    : "justify-start px-3 py-2.5 gap-3",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                aria-label={item.name}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.name : undefined}
              >
                <div className={cn("shrink-0", collapsed ? "size-5" : "size-5")}
                >
                  <Icon className="size-5" />
                </div>

                <span
                  className={cn(
                    "text-sm font-medium transition-all duration-300 ease-in-out whitespace-nowrap",
                    collapsed
                      ? "w-0 opacity-0 translate-x-4"
                      : "w-auto opacity-100 translate-x-0"
                  )}
                >
                  {item.name}
                </span>
              </button>
            );
          })}
        </nav>
        <div>
          {/* TASKS SECTION (SESSIONS) */}
          {sessions && sessions.length > 0 && (
            <div className={cn("mt-6", collapsed && "px-1")}>
              {!collapsed && (
                <p className="text-xs text-muted-foreground uppercase tracking-wide px-3">
                  Tasks
                </p>
              )}

              <div className="mt-2 space-y-1">
                {sessions.map((s) => {
                  const isActive = location.pathname.includes(s.sessionId);
                  return (
                    <Button
                      key={s._id}
                      onClick={() => handleNavigate(`/task/${s.sessionId}`)}
                      variant={isActive ? "secondary" : "ghost"}
                      className={cn(
                        "w-full justify-start text-left transition-all rounded-xl",
                        isActive && "font-medium shadow-sm"
                      )}
                    >
                      {collapsed ? (
                        <span className="text-xs font-bold">T</span>
                      ) : (
                        <span className="text-sm truncate">
                          {s.sessionId.substring(0, 20)}...
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
