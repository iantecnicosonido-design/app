import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

export const CATEGORIES = [
  { key: "audio", label: "Audio" },
  { key: "video", label: "Video" },
  { key: "luces", label: "Luces" },
  { key: "estructuras", label: "Estructuras" },
];

export const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch (e) {
    return iso;
  }
};
