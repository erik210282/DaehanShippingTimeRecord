import { useSearchParams } from 'react-router-dom';
// Each nested catalog keeps its own parameter; reloading preserves the full URL.
export function usePageSection(key, fallback, allowed) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key);
  return [allowed.includes(value) ? value : fallback, next => setParams(current => {
    const copy = new URLSearchParams(current);
    if (allowed.includes(next)) copy.set(key, next);
    return copy;
  }, { replace: true })];
}
