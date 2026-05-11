import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
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

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventario" element={<Inventory />} />
            <Route path="/eventos" element={<Events />} />
            <Route path="/eventos/:id" element={<EventDetail />} />
            <Route path="/proveedores" element={<Providers />} />
            <Route path="/packs" element={<Packs />} />
            <Route path="/flightcases" element={<Flightcases />} />
            <Route path="/vehiculos" element={<Vehicles />} />
            <Route path="/incidencias" element={<Incidents />} />
            <Route path="/timeline" element={<Timeline />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default App;
