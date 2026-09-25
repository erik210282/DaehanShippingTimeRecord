-- Existing tasks without a label plan can record labels without implying
-- that they were checked against an IDX label range.
alter table public.actividades_realizadas
  add column if not exists etiqueta_inicio_manual text,
  add column if not exists etiqueta_fin_manual text;

comment on column public.actividades_realizadas.etiqueta_inicio_manual is
  'Etiqueta inicial capturada manualmente en una actividad sin plan IDX; no equivale a validación';
comment on column public.actividades_realizadas.etiqueta_fin_manual is
  'Etiqueta final capturada manualmente en una actividad sin plan IDX; no equivale a validación';
