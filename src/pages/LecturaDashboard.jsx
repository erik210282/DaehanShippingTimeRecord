import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { format, parseISO, isAfter, isBefore } from "date-fns";
import Papa from "papaparse";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function LecturaDashboard() {
  const [logs, setLogs] = useState([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    const cargarLogs = async () => {
      const snap = await getDocs(collection(db, "lectura_logs"));
      const datos = snap.docs.map((doc) => doc.data()).filter(d => d.timestamp);
      setLogs(datos);
    };
    cargarLogs();
  }, []);

  const filtrarPorFecha = (lista) => {
    return lista.filter(log => {
      const ts = log.timestamp.toDate();
      const desdeOk = desde ? isAfter(ts, parseISO(desde)) : true;
      const hastaOk = hasta ? isBefore(ts, parseISO(hasta)) : true;
      return desdeOk && hastaOk;
    });
  };

  const contarPorCampo = (campo) => {
    const conteo = {};
    filtrarPorFecha(logs).forEach((log) => {
      const key = log[campo] || "Desconocido";
      conteo[key] = (conteo[key] || 0) + 1;
    });
    return conteo;
  };

  const contarPorHora = () => {
    const conteo = {};
    filtrarPorFecha(logs).forEach((log) => {
      const hora = format(log.timestamp.toDate(), "yyyy-MM-dd HH:00");
      conteo[hora] = (conteo[hora] || 0) + 1;
    });
    return conteo;
  };

  const exportarCSV = () => {
    const datosCSV = filtrarPorFecha(logs).map((d) => ({
      pagina: d.pagina,
      seccion: d.seccion,
      email: d.email,
      plataforma: d.plataforma,
      timestamp: format(d.timestamp.toDate(), "yyyy-MM-dd HH:mm:ss"),
    }));
    const csv = Papa.unparse(datosCSV);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "lectura_logs.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderChart = (titulo, datos) => {
    const etiquetas = Object.keys(datos);
    const valores = etiquetas.map((k) => datos[k]);

    return (
      <div style={{ marginBottom: 30 }}>
        <h3>{titulo}</h3>
        <Bar
          data={{
            labels: etiquetas,
            datasets: [
              {
                label: titulo,
                data: valores,
              },
            ],
          }}
          options={{
            responsive: true,
            plugins: { legend: { display: false } },
          }}
        />
      </div>
    );
  };

  return (
    <div className="card">
      <h2>📊 Dashboard de Lecturas Firestore</h2>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
        <label>
          Desde: <input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta: <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button onClick={exportarCSV}>📤 Exportar CSV</button>
      </div>

      {renderChart("Lecturas por Página", contarPorCampo("pagina"))}
      {renderChart("Lecturas por Usuario", contarPorCampo("email"))}
      {renderChart("Lecturas por Hora", contarPorHora())}
      {renderChart("Lecturas por Sección", contarPorCampo("seccion"))}
    </div>
  );
}
