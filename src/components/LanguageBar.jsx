// src/components/LanguageBar.jsx
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import ReactCountryFlag from "react-country-flag";

const langToCountry = (lang) => {
  if (lang === "es") return "MX";
  if (lang === "en") return "US";
  if (lang === "ko") return "KR";
  return "US";
};

export default function LanguageBar({ fixedTopRight = false }) {
  const { i18n } = useTranslation();

  // Leer idioma guardado al montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem("lang");
      if (saved && saved !== i18n.language) i18n.changeLanguage(saved);
    } catch {}
  }, [i18n]);

  const handleChange = (e) => {
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    try { localStorage.setItem("lang", lang); } catch {}
  };

  return (
    <div
      className={`lang-wrap ${i18n.language}`}
      style={
        fixedTopRight
          ? { position: "fixed", top: 16, right: 16, zIndex: 9999 }
          : undefined
      }
    >
      <ReactCountryFlag
        countryCode={langToCountry(i18n.language)}
        svg
        style={{ width: 20, height: 14 }}
        aria-label="flag"
      />
      <select
        value={i18n.language}
        onChange={handleChange}
        className="navbar-select"
        aria-label="Language"
      >
        <option value="es">Español</option>
        <option value="en">English</option>
        <option value="ko">한국어</option>
      </select>
    </div>
  );
}
