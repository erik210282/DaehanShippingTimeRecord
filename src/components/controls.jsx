// src/components/controls.jsx
import React from "react";
import Select from "react-select";
import {
  inputStyle,
  nativeSelectStyle,
  RS_COMMON_STYLES,
  primaryBtn,
  secondaryBtn,
  editBtnDark,
  dangerBtn,
  tinyRoundBtn,
} from "./styles";

export const DSInput = (props) => (
  <input {...props} style={{ ...inputStyle, ...props.style }} />
);

export const DSDate = (props) => (
  <input type="date" {...props} style={{ ...inputStyle, ...props.style }} />
);

export const DSNativeSelect = ({ children, style, ...rest }) => (
  <div style={{ position: "relative", width: "100%" }}>
    <select
      {...rest}
      style={{
        ...nativeSelectStyle,
        paddingRight: "32px", // espacio para la flecha
        ...style,
      }}
    >
      {children}
    </select>

    {/* Flechita */}
    <div
      style={{
        position: "absolute",
        right: "10px",
        top: "50%",
        transform: "translateY(-50%)",
        pointerEvents: "none",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#ccc">
        <path d="M7 10l5 5 5-5z" />
      </svg>
    </div>
  </div>
);

// Permite styles extra y setea defaults útiles (portal, posición)
export const DSSelect = ({ styles, menuPortalTarget, menuPosition = "fixed", ...rest }) => (
  <Select
    {...rest}
    styles={{ ...RS_COMMON_STYLES, ...(styles || {}) }}
    menuPortalTarget={menuPortalTarget ?? document.body}
    menuPosition={menuPosition}
  />
);

// Botones
export const BtnPrimary   = ({ children, style, ...p }) => (
  <button {...p} style={{ ...primaryBtn, ...style }}>{children}</button>
);
export const BtnSecondary = ({ children, style, ...p }) => (
  <button {...p} style={{ ...secondaryBtn, ...style }}>{children}</button>
);
export const BtnEditDark  = ({ children, style, ...p }) => (
  <button {...p} style={{ ...editBtnDark, ...style }}>{children}</button>
);
export const BtnDanger    = ({ children, style, ...p }) => (
  <button {...p} style={{ ...dangerBtn, ...style }}>{children}</button>
);
export const BtnTinyRound = ({ children, style, ...p }) => (
  <button {...p} style={{ ...tinyRoundBtn, ...style }}>{children}</button>
);
