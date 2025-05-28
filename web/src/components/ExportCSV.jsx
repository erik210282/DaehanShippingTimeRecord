import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import Papa from 'papaparse';
import Select from 'react-select';

export default function ExportCSV() {
  const [actividad, setActividad] = useState(null);
  const [producto, setProducto] = useState(null);
  const [operador, setOperador] = useState(null);

  const [actividades, setActividades] = useState([]);
  const [productos, setProductos] = useState([]);
  const [operadores, setOperadores] = useState([]);

  // Cargar listas de selección desde Firebase
  useEffect(() => {
    const cargarDatos = async () => {
      const actSnap = await getDocs(collection(db, 'actividades'));
      const prodSnap = await getDocs(collection(db, 'productos'));
      const opSnap = await getDocs(collection(db, 'operadores'));

      setActividades(
        actSnap.docs.map(doc => ({ label: doc.data().nombre, value: doc.id }))
      );
      setProductos(
        prodSnap.docs.map(doc => ({ label: doc.data().nombre, value: doc.id }))
      );
      setOperadores(
        opSnap.docs.map(doc => ({ label: doc.data().nombre, value: doc.id }))
      );
    };

    cargarDatos();
  }, []);

  const exportarDatos = async () => {
    const snapshot = await getDocs(collection(db, 'actividades_realizadas'));
    let datos = snapshot.docs.map(doc => doc.data());

    // Filtrar según lo seleccionado
    datos = datos.filter(d => {
      const cumpleActividad = !actividad || d.actividad === actividad.value;
      const cumpleProducto = !producto || d.producto === producto.value;
      const cumpleOperador = !operador || d.operadores.includes(operador.value);
      return cumpleActividad && cumpleProducto && cumpleOperador;
    });

    // Preparar CSV
    const datosCSV = datos.map(d => ({
      Actividad: d.actividad,
      Producto: d.producto,
      Operadores: d.operadores.join(', '),
      Cantidad: d.cantidad,
      HoraInicio: d.horaInicio?.toDate().toLocaleString(),
      HoraFin: d.horaFin?.toDate().toLocaleString()
    }));

    const csv = Papa.unparse(datosCSV);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'actividades_filtradas.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <h3>Filtros</h3>
      <div style={{ maxWidth: 300, marginBottom: 10 }}>
        <Select
          options={actividades}
          value={actividad}
          onChange={setActividad}
          placeholder="Filtrar por actividad"
          isClearable
        />
      </div>

      <div style={{ maxWidth: 300, marginBottom: 10 }}>
        <Select
          options={productos}
          value={producto}
          onChange={setProducto}
          placeholder="Filtrar por producto"
          isClearable
        />
      </div>

      <div style={{ maxWidth: 300, marginBottom: 10 }}>
        <Select
          options={operadores}
          value={operador}
          onChange={setOperador}
          placeholder="Filtrar por operador"
          isClearable
        />
      </div>

      <button onClick={exportarDatos}>Exportar a CSV</button>
    </div>
  );
}
