import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import Events from "@/pages/Events";
import EventDetail from "@/pages/EventDetail";
import Providers from "@/pages/Providers";
import Packs from "@/pages/Packs";
import Incidents from "@/pages/Incidents";
import Timeline from "@/pages/Timeline";
import Flightcases from "@/pages/Flightcases";
import Vehicles from "@/pages/Vehicles";
import Users from "@/pages/Users";

function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();
  if (user === undefined) return <div style={{ padding: 40, textAlign: "center", color: "var(--ink-mute)" }}>Cargando...</div>;
  if (user === null) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventario" element={<Inventory />} />
              <Route path="/eventos" element={<Events />} />
              <Route path="/eventos/:id" element={<EventDetail />} />
              <Route path="/proveedores" element={<ProtectedRoute roles={["productor", "almacen"]}><Providers /></ProtectedRoute>} />
              <Route path="/packs" element={<ProtectedRoute roles={["productor", "almacen"]}><Packs /></ProtectedRoute>} />
              <Route path="/flightcases" element={<ProtectedRoute roles={["productor", "almacen"]}><Flightcases /></ProtectedRoute>} />
              <Route path="/vehiculos" element={<ProtectedRoute roles={["productor", "almacen"]}><Vehicles /></ProtectedRoute>} />
              <Route path="/incidencias" element={<Incidents />} />
              <Route path="/timeline" element={<ProtectedRoute roles={["productor", "almacen"]}><Timeline /></ProtectedRoute>} />
              <Route path="/usuarios" element={<ProtectedRoute roles={["productor"]}><Users /></ProtectedRoute>} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default App;
