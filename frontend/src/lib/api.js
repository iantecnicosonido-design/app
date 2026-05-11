import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, withCredentials: true });

// add bearer token if available (fallback to cookie)
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("auth_token");
  if (token) cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` };
  return cfg;
});

// global 401 handler: redirect to /login except for the /auth/me probe
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const url = err.config?.url || "";
      const isProbe = url.includes("/auth/me") || url.includes("/auth/login");
      if (!isProbe && window.location.pathname !== "/login") {
        localStorage.removeItem("auth_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

// Default fallback - real list comes from /api/categories
export const CATEGORIES = [
  { key: "audio", label: "Audio" },
  { key: "video", label: "Video" },
  { key: "luces", label: "Luces" },
  { key: "estructuras", label: "Estructuras" },
  { key: "cables", label: "Cables" },
];

export const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
};

export const useCategories = () => {
  // not a real hook, just a fetcher helper
  return api.get("/categories").then((r) => r.data);
};
