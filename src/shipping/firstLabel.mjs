// Numeric scans use the same 6J default offered by the first-label field.
export function normalizeFirstLabel(value) {
  const code = String(value ?? '').toUpperCase().replace(/\s+/g, '');
  return /^\d{4,64}$/.test(code) ? `6J${code}` : code;
}

export function planErrorMessage(error, t) {
  if (error?.message === 'shipping_label_conflict') {
    try {
      const {idx, label} = JSON.parse(error.details);
      return t('task_label_conflict', {idx, label});
    } catch { return t('task_label_conflict_unknown'); }
  }
  return error?.message || t('error_saving');
}
