import React, { useEffect, useState } from 'react';
import supabase from '../supabase/client';
import Papa from 'papaparse';
import Select from 'react-select';

export default function ExportCSV() {
  const [actividad, setActividad] = useState(null);
  const [producto, setProducto] = useState(null);
  const [operador, setOperador] = useState(null);

  const [actividades, setActividades] = useState([]);
  const [productos, setProductos] = useState([]);
  const [operadores, setOperadores] = useState([]);

   useEffect(() => {
    const cargarDatos = async () => {
      const [actRes, prodRes, opRes] = await Promise.all([
        supabase.from('actividades').select('id, nombre'),
        supabase.from('productos').select('id, nombre'),
        supabase.from('operadores').select('id, nombre'),
      ]);

      if (!actRes.error) {
        setActividades(actRes.data.map(a => ({ label: a.nombre, value: a.id })));
      }
      if (!prodRes.error) {
        setProductos(prodRes.data.map(p => ({ label: p.nombre, value: p.id })));
      }
      if (!opRes.error) {
        setOperadores(opRes.data.map(o => ({ label: o.nombre, value: o.id })));
      }
    };

    cargarDatos();
  }, []);

  const exportarDatos = async () => {
    const { data, error } = await supabase.from('actividades_realizadas').select('*');

    if (error) {
      console.error('Error al obtener datos:', error);
      return;
    }

    let datos = data;

    // Filtrar según lo seleccionado
    datos = datos.filter(d => {
      const cumpleActividad = !actividad || d.actividad === actividad.value;
      const cumpleProducto = !producto || d.producto === producto.value;
      const cumpleOperador = !operador || (Array.isArray(d.operadores) && d.operadores.includes(operador.value));
      return cumpleActividad && cumpleProducto && cumpleOperador;
    });

    // Preparar CSV
    const datosCSV = datos.map(d => ({
      Actividad: d.actividad,
      Producto: d.producto,
      Operadores: Array.isArray(d.operadores) ? d.operadores.join(', ') : '',
      Cantidad: d.cantidad,
      HoraInicio: d.horaInicio ? new Date(d.horaInicio).toLocaleString() : '',
      HoraFin: d.horaFin ? new Date(d.horaFin).toLocaleString() : ''
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