import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import type { DeviceInfo } from "../api/types";

export function DevicePanelPage() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [filter, setFilter] = useState<"all" | "sensor" | "actuator">("all");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    apiFetch<{ devices: DeviceInfo[] }>("/v1/devices").then((res) => {
      setDevices(res.devices ?? []);
    }).catch(() => {});
    const id = setInterval(() => {
      apiFetch<{ devices: DeviceInfo[] }>("/v1/devices").then((res) => setDevices(res.devices ?? [])).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, []);

  const filtered = devices
    .filter((d) => filter === "all" || d.device_type === filter)
    .filter((d) => !statusFilter || d.status === statusFilter);

  const sensors = filtered.filter((d) => d.device_type === "sensor");
  const actuators = filtered.filter((d) => d.device_type === "actuator");

  const statusColors: Record<string, string> = {
    online: "bg-emerald-500",
    offline: "bg-red-500",
    degraded: "bg-amber-500",
    unknown: "bg-zinc-500",
  };

  const healthColors: Record<string, string> = {
    healthy: "text-emerald-400",
    degraded: "text-amber-400",
    unhealthy: "text-red-400",
    unknown: "text-zinc-500",
  };

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-zinc-200">Device Panel</h2>

      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {(["all", "sensor", "actuator"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded text-xs capitalize ${filter === f ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-300"
        >
          <option value="">All Statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="degraded">Degraded</option>
        </select>
        <div className="text-xs text-zinc-500">{filtered.length} devices</div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-zinc-600 text-xs py-8 text-center">
          No devices found (endpoint: GET /v1/devices)
        </div>
      ) : (
        <>
          {sensors.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Sensors ({sensors.length})</h3>
              <div className="grid grid-cols-3 gap-3">
                {sensors.map((d) => (
                  <DeviceCard key={d.device_id} device={d} statusColors={statusColors} healthColors={healthColors} />
                ))}
              </div>
            </div>
          )}

          {actuators.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Actuators ({actuators.length})</h3>
              <div className="grid grid-cols-3 gap-3">
                {actuators.map((d) => (
                  <DeviceCard key={d.device_id} device={d} statusColors={statusColors} healthColors={healthColors} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeviceCard({ device, statusColors, healthColors }: {
  device: DeviceInfo;
  statusColors: Record<string, string>;
  healthColors: Record<string, string>;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${statusColors[device.status] ?? "bg-zinc-500"}`} />
          <span className="text-xs text-zinc-300 font-medium">{device.device_id.slice(0, 12)}</span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${healthColors[device.health_status] ?? "text-zinc-500"}`}>
          {device.health_status}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span className="px-1 py-0.5 rounded bg-zinc-800">{device.device_type}</span>
        <span>{device.status}</span>
        {device.modality && <span>{device.modality}</span>}
      </div>
    </div>
  );
}
