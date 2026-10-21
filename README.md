# DAEHAN APP

Portal web de la organización. Incluye inicio, anuncios, acceso por departamento y el módulo operativo de Shipping.

## Desarrollo

```bash
npm ci
npm run dev
```

La web usa el proyecto existente de Supabase y se publica con Vercel. La configuración de cada departamento se administra desde Settings.

## Reapertura de productos en Producción

En Reporte Parcial, **Reabrir producto** permite continuar un producto cerrado dentro de su sesión original. Conserva las piezas acumuladas, los reportes anteriores y el mismo borrador de Reporte Diario. El tiempo cerrado queda identificado y se excluye del tiempo de producción, del UPH, de la meta y de los descansos correspondientes a ese intervalo.

La reapertura se admite dentro de las primeras 24 horas del turno y antes de confirmar el reporte en inventario. Se rechaza si otra sesión ya ocupa la misma línea. Las nuevas capturas continúan con cantidades acumuladas.
