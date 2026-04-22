import { NavLink, Outlet } from "react-router";
import { useAuthStore } from "../../stores/auth.store";

const navSections = [
  {
    label: "Overview",
    items: [{ path: "/dashboard", label: "Dashboard" }],
  },
  {
    label: "Sessions",
    items: [
      { path: "/sessions", label: "Session List" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { path: "/agents", label: "Multi-Agent" },
      { path: "/world", label: "World Model" },
      { path: "/devices", label: "Devices" },
    ],
  },
  {
    label: "Operations",
    items: [
      { path: "/evals", label: "Eval Runs" },
      { path: "/approvals", label: "Approvals" },
      { path: "/config", label: "Configuration" },
    ],
  },
];

export function AppLayout() {
  const { tenantId, role, logout } = useAuthStore();

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <aside className="w-56 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h1 className="text-sm font-bold tracking-wide text-zinc-300">NeuroCore</h1>
          <p className="text-xs text-zinc-500">Operations Console</p>
          <div className="mt-2 text-[10px] text-zinc-600">
            <div>{tenantId ?? "unknown tenant"}</div>
            <div>{role ?? "viewer"}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {navSections.map((section) => (
            <div key={section.label} className="mb-3">
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                {section.label}
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `block px-4 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "text-sky-400 bg-zinc-900 border-l-2 border-sky-500"
                        : "text-zinc-400 hover:text-zinc-200 border-l-2 border-transparent"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-3">
          <button
            onClick={logout}
            className="w-full rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
