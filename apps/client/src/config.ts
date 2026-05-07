const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = configuredApiBaseUrl || (
  import.meta.env.DEV ? "http://localhost:3001" : ""
);

export const SOCKET_URL = API_BASE_URL || undefined;
