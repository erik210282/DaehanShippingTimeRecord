import {uiTokens,uiTitle,resolveIntent,actionLabel} from './actionTheme.mjs';
import './actionTheme.css';
// src/components/controls.jsx
import React from "react";
import Select, { components } from "react-select";
import {
  inputStyle,
  nativeSelectStyle,
  RS_COMMON_STYLES,
  primaryBtn,
  secondaryBtn,
  editBtnDark,
  dangerBtn,
  tinyRoundBtn,
  pillInput,
  pillInputNumber,
  textAreaStyle,
} from "./styles";
import { useTranslation } from "react-i18next";

export const PillInput = ({ style, ...props }) => (
  <input {...props} style={{ ...pillInput, ...style }} />
);

export const PillInputNumber = ({ style, ...props }) => (
  <input {...props} style={{ ...pillInputNumber, ...style }} />
);

export const TextAreaStyle = ({ style, ...props }) => (
  <textarea {...props} style={{ ...textAreaStyle, ...style }} />
);

export const DSInput = ({ style, ...props }) => (
  <input {...props} style={{ ...inputStyle, ...style }} />
);

export const DSDate = ({ style, ...props }) => (
  <input type="date" {...props} style={{ ...inputStyle, ...style }} />
);

export const DSNativeSelect = ({ children, style, ...rest }) => (
  <select
    {...rest}
    style={{
      ...nativeSelectStyle, 
      ...style,
    }}
  >
    {children}
  </select>
);

export const DSSelect = ({
  styles,
  components: customComponents,
  menuPortalTarget,
  menuPosition = "fixed",
  isMulti,
  closeMenuOnSelect,
  noOptionsMessage,
  loadingMessage,
  ...rest
}) => {
  const {t}=useTranslation();
  const effectiveClose =
    typeof closeMenuOnSelect === "boolean"
      ? closeMenuOnSelect
      : true;

  return (
    <Select
      {...rest}
      classNamePrefix="ui-select"
      noOptionsMessage={noOptionsMessage||(()=>t('select_no_options'))}
      loadingMessage={loadingMessage||(()=>t('loading'))}
      isMulti={isMulti}  
      closeMenuOnSelect={effectiveClose} 
      styles={Object.fromEntries([...new Set([...Object.keys(RS_COMMON_STYLES),...Object.keys(styles||{})])].map(key=>[key,(base,state)=>{const value=(styles?.[key]||RS_COMMON_STYLES[key]||((b)=>b))(base,state);const common=(RS_COMMON_STYLES[key]||((b)=>b))(base,state);return {...common,...value,...(['control','menu','menuList'].includes(key)?{backgroundColor:'#333333',color:'#fff'}:{}),...(['placeholder','singleValue','input','multiValueLabel','dropdownIndicator','clearIndicator'].includes(key)?{color:key==='placeholder'?'#c4c4c4':'#fff'}:{}),...(key==='control'?{minHeight:44,fontSize:16,borderRadius:10,borderColor:'#555'}:{})};}]))}
      components={{
        ...customComponents,
        
        IndicatorSeparator: () => null,
      }}
      menuPortalTarget={menuPortalTarget ?? document.body}
      menuPosition={menuPosition}
    />
  );
};

// --------- Botones ----------
function actionText(children){return React.Children.toArray(children).map(c=>typeof c==='string'||typeof c==='number'?String(c):React.isValidElement(c)?actionText(c.props.children):'').join(' ');}
export function AppAction({children,style,intent,tone='primary',preserveLabel=false,...props}){
 const resolved=resolveIntent(intent,tone),background=uiTokens[resolved],base=resolved==='danger'?dangerBtn:resolved==='neutral'?secondaryBtn:primaryBtn;
 const layout={...style};for(const key of ['background','backgroundColor','color','border','borderColor','borderRadius','padding','paddingTop','paddingBottom','fontSize','fontFamily','fontWeight','height','minHeight','lineHeight','textAlign','boxShadow'])delete layout[key];
 return <button {...props} data-ui-intent={resolved} data-button-tone={resolved==='neutral'?'secondary':resolved==='danger'?'danger':'primary'} style={{...layout,...base,...layout,background,borderColor:background,color:'#fff'}}>{preserveLabel?actionText(children):actionLabel(actionText(children),resolved)}</button>;
}
export const BtnPrimary=props=><AppAction {...props}/>;
export const BtnSecondary=props=><AppAction {...props} tone="secondary"/>;
export const BtnEditDark=props=><AppAction {...props} tone="secondary"/>;
export const BtnDanger=props=><AppAction {...props} tone="danger"/>;

export const BtnTinyRound = ({ children, style, ...p }) => (
  <button {...p} style={{ ...tinyRoundBtn, ...style }}>
    {children}
  </button>
);

export const BtnToggleUrgent = ({ active, children, ...props }) => (
  <button
    {...props}
    style={{
      minHeight: 44,
      width: 170,
      lineHeight: "22px",
      padding: "0 14px",
      backgroundColor: active ? "#dc2626" : "#111",
      border: active ? "2px solid #dc2626" : "2px solid #111",
      color: "#fff",
      borderRadius: 6,
      cursor: "pointer",
      fontWeight: 600,
    }}
  >
    {children}
  </button>
);

// ===========================
// PAGINADO GENERAL
// ===========================
export const TablePagination = ({
  totalRows,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}) => {
  const { t } = useTranslation();

  const containerStyle = {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    marginTop: 10,
    gap: 10,
    fontSize: 12,
  };

  const pagesContainerStyle = {
    display: "flex",
    alignItems: "center",
    gap: 4,
  };

  // usamos la altura parecida a tus botones
  const smallBtnStyle = {
    padding: "0 10px",
    fontSize: 12,
    minWidth: 28,
    height: 32,
    lineHeight: "32px",
  };

  // texto un poco más oscuro
  const textStyle = {
    fontSize: 12,
    color: "#333",
  };

  const totalPages = Math.max(1, Math.ceil((totalRows || 0) / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const startRow = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, totalRows);

  const buildPages = (current, total) => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [1];

    if (current > 3) pages.push("...");

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let p = start; p <= end; p++) {
      pages.push(p);
    }

    if (current < total - 2) pages.push("...");

    pages.push(total);

    return pages;
  };

  const pages = buildPages(currentPage, totalPages);

  const changePage = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    onPageChange(newPage);
  };

  return (
    <div className="table-pagination" style={containerStyle}>
      {/* info izquierda */}
      <div style={textStyle}>
        {totalRows === 0
          ? t("pagination_no_records", "0 records")
          : t("pagination_info", {
              start: startRow,
              end: endRow,
              total: totalRows,
              defaultValue: `Showing ${startRow}–${endRow} of ${totalRows} records`,
            })}
      </div>

      {/* controles derecha */}
      <div style={pagesContainerStyle}>
        <span style={textStyle}>{t("rows", "Rows")}:</span>

        <DSNativeSelect
          value={pageSize}
          onChange={(e) => {
            const newSize = Number(e.target.value);
            onPageSizeChange(newSize);
          }}
          style={{
            width: 70,
            height: 32,
            minHeight: 32,
            lineHeight: "32px",
            fontSize: 12,
            padding: "0 6px",
            marginTop: 16,
          }}
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </DSNativeSelect>

        {/* primera página */}
        <BtnSecondary intent="neutral"
          style={smallBtnStyle}
          onClick={() => changePage(1)}
          disabled={currentPage === 1}
        >
          «
        </BtnSecondary>

        {/* anterior */}
        <BtnSecondary intent="neutral"
          style={smallBtnStyle}
          onClick={() => changePage(currentPage - 1)}
          disabled={currentPage === 1}
        >
          ‹
        </BtnSecondary>

        {/* números */}
        {pages.map((p, idx) =>
          p === "..." ? (
            <span
              key={`dots-${idx}`}
              style={{ ...textStyle, padding: "0 6px" }}
            >
              …
            </span>
          ) : (
            <BtnSecondary intent="neutral"
              key={`page-${p}-${idx}`} // clave única
              style={{
                ...smallBtnStyle,
                background: p === currentPage ? "#3b82f6" : "#111",
                borderColor: p === currentPage ? "#3b82f6" : "#111",
              }}
              onClick={() => changePage(p)}
            >
              {p}
            </BtnSecondary>
          )
        )}

        {/* siguiente */}
        <BtnSecondary intent="neutral"
          style={smallBtnStyle}
          onClick={() => changePage(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          ›
        </BtnSecondary>

        {/* última */}
        <BtnSecondary intent="neutral"
          style={smallBtnStyle}
          onClick={() => changePage(totalPages)}
          disabled={currentPage === totalPages}
        >
          »
        </BtnSecondary>
      </div>
    </div>
  );
};
