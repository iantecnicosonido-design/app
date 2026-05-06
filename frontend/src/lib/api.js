import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

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
