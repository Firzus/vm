export const VM_API_URL =
  process.env.NEXT_PUBLIC_VM_API_URL ?? "http://localhost:8000";

export const VM_VNC_HOST =
  process.env.NEXT_PUBLIC_VM_VNC_HOST ?? "localhost";

export const VM_VNC_PORT = Number(
  process.env.NEXT_PUBLIC_VM_VNC_PORT ?? "6080",
);

export const VM_VNC_PASSWORD =
  process.env.NEXT_PUBLIC_VM_VNC_PASSWORD ?? "agent";

export const VM_API_INTERNAL = process.env.VM_API_URL ?? VM_API_URL;
