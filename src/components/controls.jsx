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

const DropdownArrow = (props) => (
  <components.DropdownIndicator {...props}>
    <span
      style={{
        fontSize: 15,
        color: "#ffffff",
        lineHeight: 1,
        display: "inline-block",
        transform: "translateY(-1px)", // pequeño ajuste vertical
      }}
    >
      ▾
    </span>
  </components.DropdownIndicator>
);

export const DSSelect = ({
  styles,
  components: customComponents,
  menuPortalTarget,
  menuPosition = "fixed",
  isMulti,
  closeMenuOnSelect,
  ...rest
}) => {
  const effectiveClose =
    typeof closeMenuOnSelect === "boolean"
      ? closeMenuOnSelect
      : true;

  return (
    <Select
      {...rest}
      isMulti={isMulti}  
      closeMenuOnSelect={effectiveClose} 
      styles={{ ...RS_COMMON_STYLES, ...(styles || {}) }}
      components={{
        ...customComponents,
        DropdownIndicator: DropdownArrow,
        IndicatorSeparator: () => null,
      }}
      menuPortalTarget={menuPortalTarget ?? document.body}
      menuPosition={menuPosition}
    />
  );
};

// --------- Botones ----------
export const BtnPrimary = ({ children, style, ...p }) => (
  <button {...p} style={{ ...primaryBtn, ...style }}>
    {children}
  </button>
);

export const BtnSecondary = ({ children, style, ...p }) => (
  <button {...p} style={{ ...secondaryBtn, ...style }}>
    {children}
  </button>
);

export const BtnEditDark = ({ children, style, ...p }) => (
  <button {...p} style={{ ...editBtnDark, ...style }}>
    {children}
  </button>
);

export const BtnDanger = ({ children, style, ...p }) => (
  <button {...p} style={{ ...dangerBtn, ...style }}>
    {children}
  </button>
);

export const BtnTinyRound = ({ children, style, ...p }) => (
  <button {...p} style={{ ...tinyRoundBtn, ...style }}>
    {children}
  </button>
);

export const BtnToggleUrgent = ({ active, ...props }) => (
   <button
    {...props}
    style={{
      height: 38,
      width: 170,
      lineHeight: "38px",
      padding: "0 14px",
      borderRadius: 8,
      cursor: "pointer",
      fontWeight: 600,

      // colores base
      backgroundColor: active ? "#b71c1c" : "#111",
      border: active ? "2px solid #b71c1c" : "2px solid #111",
      color: "#fff",

      // permitir que le pases estilos extra desde la pantalla
      ...(style || {}),
    }}
  />
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
    justifyContent: "space-between",
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
    <div style={containerStyle}>
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
        <BtnSecondary
          style={smallBtnStyle}
          onClick={() => changePage(1)}
          disabled={currentPage === 1}
        >
          «
        </BtnSecondary>

        {/* anterior */}
        <BtnSecondary
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
            <BtnSecondary
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
        <BtnSecondary
          style={smallBtnStyle}
          onClick={() => changePage(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          ›
        </BtnSecondary>

        {/* última */}
        <BtnSecondary
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