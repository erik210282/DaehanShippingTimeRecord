# 📘 README – Registro de Actividades (Web)

## 📦 Descripción General
Esta es la versión web del sistema **Registro de Actividades** utilizado por Daehan Shipping para registrar, consultar y analizar tareas operativas de producción. La aplicación permite:

- Asignar y gestionar tareas pendientes
- Registrar actividades realizadas con tiempos y operadores
- Consultar productividad con gráficas y filtros
- Administrar catálogos y usuarios
- Consultar un resumen consolidado por proceso (IDX)

## 🧰 Tecnologías Utilizadas
- React.js con Hooks
- Supabase como backend y base de datos
- Chart.js y react-chartjs-2 para visualización
- react-select y react-modal
- i18next para internacionalización
- React Toastify para notificaciones

## 🚀 Instalación
npm install
npm run dev

La app se ejecuta por defecto en: http://localhost:5173/

## 📁 Estructura Principal
- Login.jsx: Inicio de sesión de usuarios mediante Supabase
- TareasPendientes.jsx: Asignación y gestión de tareas
- FinishScreen / StartScreen (móvil): Registro desde app móvil (no incluida aquí)
- Registros.jsx: Historial y filtrado de actividades realizadas
- Productividad.jsx: Estadísticas y gráficas por actividad, operador o producto
- Catalogos.jsx: Gestión de catálogos (actividades, productos, operadores)
- Usuarios.jsx: Creación y gestión de usuarios supervisores
- Resumen.jsx: Consolidado de actividades agrupadas por IDX y etapa
- ConfiguracionTareas.jsx: Configuración del orden de etapas

## 🔐 Autenticación
Utiliza supabase.auth.signInWithPassword para acceder. El token del usuario se guarda en localStorage y permite acceder a las demás secciones si está logueado.

## 🌐 Soporte multilenguaje
Todas las etiquetas están conectadas a i18next. Para agregar idiomas nuevos, edita el archivo de traducciones en /i18n.

## 🛠️ Requisitos
- Node.js 18+
- Supabase configurado con las tablas necesarias (actividades, productos, operadores, actividades_realizadas, tareas_pendientes)
- Backend para usuarios (/create-user, /list-users, etc.) alojado en Render.com o similar
