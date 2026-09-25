-- Load activities without a label plan still capture their trailer and door.
-- Planned activities keep using shipping_activity_labels for validated captures.
alter table public.actividades_realizadas
  add column if not exists trailer text,
  add column if not exists puerta text;

comment on column public.actividades_realizadas.trailer is
  'Trailer capturado al iniciar un Load sin plan de etiquetas';
comment on column public.actividades_realizadas.puerta is
  'Puerta capturada al iniciar un Load sin plan de etiquetas';
