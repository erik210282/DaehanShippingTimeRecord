// src/components/styles.js
export const FIELD_HEIGHT = 38;
export const FIELD_FONT =
  "'Inter', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

export const inputStyle = {
  width: "100%",
  height: FIELD_HEIGHT,
  minHeight: FIELD_HEIGHT,
  lineHeight: `${FIELD_HEIGHT}px`,
  padding: "8 14px",
  backgroundColor: "#333",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 10,
  fontSize: 14,
  fontFamily: FIELD_FONT,
  boxSizing: "border-box",
};

export const nativeSelectStyle = {
  ...inputStyle,
  lineHeight: "normal",
};

export const RS_COMMON_STYLES = {
  control: (base, state) => {
    const isMulti = state.isMulti ?? state.selectProps?.isMulti;

    return {
      ...base,
      backgroundColor: "#333",
      borderColor: state.isFocused ? "#007BFF" : "#333",
      boxShadow: "none",
      minHeight: FIELD_HEIGHT,
      // 👉 los single siguen fijos, los multi crecen
      height: isMulti ? "auto" : FIELD_HEIGHT,
      borderRadius: 10,
      cursor: "pointer",
      fontFamily: FIELD_FONT,
      fontSize: 14,
    };
  },

  valueContainer: (base, state) => {
    const isMulti = state.isMulti ?? state.selectProps?.isMulti;
    const hasValues = Array.isArray(state.getValue()) && state.getValue().length > 0;

    return {
      ...base,
      // 👉 Si es multi y NO tiene valores → altura normal
      height: isMulti && !hasValues ? FIELD_HEIGHT : "auto",
      padding: "8px 14px",
      // 👉 Alinear arriba solo SI hay pills
      alignItems: isMulti && hasValues ? "flex-start" : "center",
      // 👉 Wrap hasta que aparezcan pills
      flexWrap: isMulti && hasValues ? "wrap" : "nowrap",
    };
  },

  placeholder: (base) => ({ ...base, color: "#bbb" }),
  singleValue: (base) => ({ ...base, color: "#fff" }),
  input: (base) => ({ ...base, color: "#fff" }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base) => ({ ...base, color: "#fff" }),
  clearIndicator: (base) => ({ ...base, color: "#fff" }),
  menu: (base) => ({ ...base, backgroundColor: "#333", zIndex: 9999 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? "#007BFF"
      : state.isFocused
      ? "#555"
      : "#333",
    color: "#fff",
  }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: "#007BFF",
    color: "#fff",
    borderRadius: 4,
  }),
  multiValueLabel: (base) => ({ ...base, color: "#fff", fontWeight: "bold" }),
  multiValueRemove: (base) => ({
    ...base,
    color: "#fff",
    ":hover": { backgroundColor: "#0056b3", color: "#fff" },
  }),
};

// === Botones ===
export const pillInput = {
  width: "100%",
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid #cfd4dc",
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
};
export const pillInputNumber = {
  width: "55px",
  height: "34px",
  textAlign: "center",
  fontSize: "15px",
  borderRadius: "8px",
  border: "1px solid #cfd4dc",
  outline: "none",
  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
  padding: "2px 6px",
  margin: 0,
};
export const textAreaStyle = { ...pillInput, resize: "vertical" };

export const primaryBtn = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "none",
  background: "linear-gradient(180deg,#3b82f6,#1d4ed8)",
  color: "#fff",
  cursor: "pointer",
  boxShadow: "0 4px 10px rgba(6, 26, 136, 0.25)",
};
export const secondaryBtn = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};
export const editBtnDark = { ...secondaryBtn };

export const dangerBtn = {
  padding: "8px 14px",
  borderRadius: "10px",
  border: "1px solid #111",
  background: "#111",
  color: "#fd2b1cff",
  cursor: "pointer",
};
export const tinyRoundBtn = {
  width: 34,
  height: 34,
  borderRadius: "9999px",
  border: "1px solid #111",
  background: "#111",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  userSelect: "none",
  padding: 0,
  margin: 0,
  transform: "translateY(1px)",
};
