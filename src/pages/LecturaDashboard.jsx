
import React, { useEffect, useState } from "react";
import { db } from "../firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { format } from "date-fns";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import Papa from "papaparse";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const LecturaDashboard = () => {
  const [logs, setLogs] = useState([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  useEffect(() => {
    const cargarLogs = async () => {
      const snap = await getDocs(collection(db, "lectura_logs"));
      const data = snap.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      }));
      setLogs(data);
    };
    cargarLogs();
  }, []);

  const filtrarPorFecha = (logs) => {
    return logs.filter((log) => {
      const ts = new Date(log.timestamp?.seconds * 1000 || log.timestamp);
      const desdeDate = desde ? new Date(desde) : null;
      const hastaDate = hasta ? new Date(hasta) : null;
      return (!desdeDate || ts >= desdeDate) && (!hastaDate || ts <= hastaDate);
    });
  };

  const logsFiltrados = filtrarPorFecha(
    filtroTipo === "todos"
      ? logs
      : logs.filter((log) => log.tipo === filtroTipo)
  );

  const totalEventos = logsFiltrados.reduce((acc, log) => acc + (log.cantidad || 1), 0);

  const agruparPorCampo = (campo) => {
    const conteo = {};
    logsFiltrados.forEach((log) => {
      const key = log[campo] || "sin valor";
      conteo[key] = (conteo[key] || 0) + (log.cantidad || 1);
    });
    return conteo;
  };

  const agruparPorHora = () => {
    const conteo = {};
    logsFiltrados.forEach((log) => {
      const ts = new Date(log.timestamp?.seconds * 1000 || log.timestamp);
      const hora = format(ts, "yyyy-MM-dd HH:00");
      conteo[hora] = (conteo[hora] || 0) + (log.cantidad || 1);
    });
    return conteo;
  };

  const exportarCSV = () => {
    const csv = Papa.unparse(logsFiltrados);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "logs.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderBarChart = (titulo, data) => (
    <div style={{ marginBottom: "30px" }}>
      <h3>{titulo}</h3>
      <Bar
        data={{
          labels: Object.keys(data),
          datasets: [
            {
              label: "Accesos",
              data: Object.values(data),
              backgroundColor: "rgba(75,192,192,0.6)",
            },
          ],
        }}
      />
    </div>
  );

  return (
    <div style={{ padding: "20px" }}>
      <h2>Dashboard de Logs (Lecturas y Escrituras)</h2>

      <div style={{ marginBottom: "10px" }}>
        <label>Desde: </label>
        <input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <label style={{ marginLeft: "10px" }}>Hasta: </label>
        <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label>Tipo:</label>
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos</option>
          <option value="lectura">Lecturas</option>
          <option value="escritura">Escrituras</option>
        </select>
      </div>

      <h3>Total de eventos registrados (lecturas + escrituras): {totalEventos}</h3>

      <button onClick={exportarCSV}>Exportar CSV</button>

      {renderBarChart("Por Página", agruparPorCampo("pagina"))}
      {renderBarChart("Por Usuario", agruparPorCampo("email"))}
      {renderBarChart("Por Hora", agruparPorHora())}
      {renderBarChart("Por Sección", agruparPorCampo("seccion"))}
      {renderBarChart("Por Tipo", agruparPorCampo("tipo"))}
    </div>
  );
};

export default LecturaDashboard;
