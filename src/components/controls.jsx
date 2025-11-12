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
} from "./styles";

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
  ...rest
}) => (
  <Select
    {...rest}
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