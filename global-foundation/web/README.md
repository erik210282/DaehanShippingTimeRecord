# Daehan Global · base web aislada

Este directorio es una aplicación Vite independiente. La web de Shipping en la raíz del repositorio y su despliegue de Vercel continúan sin cambios.

## Qué funciona en esta base

- Inicio con Shipping, Production, Calidad, Receiving, Inventario y Settings.
- Acceso a departamentos según las asignaciones del usuario, con roles `operador`, `lider` y `supervisor`.
- Settings para asignar departamentos y publicar anuncios generales o dirigidos a un usuario.
- Traducciones español, inglés y coreano; colores y navegación inspirados en la web de Shipping.
- Pantallas reservadas para cada departamento. **Shipping todavía no se ha migrado.**

## Ejecutar sin tocar producción

1. Crear una base Supabase **de pruebas aislada** con la estructura existente necesaria para `auth.users` y `public.operadores`. No conectar este proyecto al Supabase de Shipping en producción.
2. Aplicar `schema/001_global_foundation.sql` solamente en esa base de pruebas.
3. Crear un usuario de prueba en Auth y su fila correspondiente en `operadores` (`uid`, `nombre`, `activo = true`).
4. Para habilitar Settings, insertar su UUID en `global_system_admins` desde un entorno administrativo de confianza. No hay ruta cliente para autoasignarse administrador.
5. Copiar `.env.example` a `.env.local` y poner la URL y clave **publicable** de la base de pruebas.
6. Ejecutar `npm install` y `npm run dev`. Para verificar el empaquetado, `npm run build`.

La web y el móvil deben usar la misma base de **pruebas** para ver los mismos anuncios y accesos. Las variables de entorno no tienen valor predeterminado para impedir conexiones accidentales a producción.

## Próximas etapas

Migrar Shipping después de revisar sus flujos existentes y validarlos contra el sistema actual. Inventario incluirá una conciliación física mensual donde se ingresará la existencia real, pero el detalle de captura, tolerancias y autorización se definirá al trabajar ese módulo. No se ejecutan migraciones de la base actual desde esta carpeta.
