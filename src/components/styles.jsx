// src/components/styles.js
export const FIELD_HEIGHT = 44;
export const FIELD_FONT =
  "'Inter', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";

export const inputStyle={width:'100%',minWidth:0,maxWidth:'100%',height:44,minHeight:44,lineHeight:'22px',padding:'10px 12px',backgroundColor:'#333333',color:'#ffffff',border:'1px solid #555555',borderRadius:10,fontSize:16,fontFamily:FIELD_FONT,boxSizing:'border-box'};

export const nativeSelectStyle = {
  ...inputStyle,
  lineHeight: "normal",
};

export const RS_COMMON_STYLES = {
  control: (base, state) => {
    const isMulti = state.isMulti ?? state.selectProps?.isMulti;

    return {
      ...base,
      display: "flex",
      backgroundColor: "#333",
      borderColor: state.isFocused ? "#007BFF" : "#333",
      boxShadow: "none",
      minHeight: FIELD_HEIGHT,
      alignItems: "center", 
      height: isMulti ? "auto" : FIELD_HEIGHT,
      borderRadius: 10,
      cursor: "pointer",
      fontFamily: FIELD_FONT,
      fontSize: 14,
      padding: 0,
    };
  },

  valueContainer: (base, state) => {
    const isMulti = state.isMulti ?? state.selectProps?.isMulti;
    const hasValues = Array.isArray(state.getValue()) && state.getValue().length > 0;

    return {
      ...base,
      height: isMulti && hasValues ? "auto" : FIELD_HEIGHT,
      padding: "0 14px",
      alignItems: isMulti && hasValues ? "flex-start" : "center",
      flexWrap: isMulti && hasValues ? "wrap" : "nowrap",
      display: "flex",
      minWidth: 0,
      overflow: "hidden",
    };
  },

  placeholder: (base) => ({ ...base, color: "#bbb" }),
  singleValue: (base) => ({ ...base, color: "#fff", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
  input: (base) => ({ ...base, color: "#fff" }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base) => ({ 
    ...base, 
    color: "#fff",
    display: "flex",     
    alignItems: "center",
  }),
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
    display: "flex", 
    alignItems: "center", 
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
export const pillInput={...inputStyle};
export const pillInputNumber={...inputStyle,width:60,minWidth:60,maxWidth:60,textAlign:'center',padding:'10px 4px',margin:0};
export const textAreaStyle={...inputStyle,height:'auto',minHeight:88,resize:'vertical'};
const actionBase={padding:'11px 14px',minHeight:44,borderRadius:10,fontSize:14,fontWeight:600,lineHeight:'20px',fontFamily:FIELD_FONT,display:'inline-flex',alignItems:'center',justifyContent:'center',textAlign:'center',gap:6,cursor:'pointer',boxSizing:'border-box',boxShadow:'none',maxWidth:'100%'};
export const primaryBtn={...actionBase,background:'#2563eb',border:'1px solid #2563eb',color:'#fff'};
export const secondaryBtn={...actionBase,background:'#111111',border:'1px solid #111111',color:'#fff'};
export const editBtnDark={...secondaryBtn};
export const dangerBtn={...actionBase,background:'#dc2626',border:'1px solid #dc2626',color:'#fff'};
export const tinyRoundBtn = {
  color: "#fff",
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
