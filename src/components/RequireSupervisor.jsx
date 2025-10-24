// src/components/RequireSupervisor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../supabase/client";

export default function RequireSupervisor({ children }) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;

      if (!user) {
        setChecking(false);
        setAllowed(false);
        navigate("/"); // redirige al login si no hay sesión
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("❌ Error verificando rol:", error);
        setAllowed(false);
        setChecking(false);
        return;
      }

      const isSupervisor = profile?.role === "supervisor" && profile?.is_active === true;

      if (mounted) {
        setAllowed(isSupervisor);
        setChecking(false);
        if (!isSupervisor) {
          // Si es operador, cerrar sesión y redirigir
          await supabase.auth.signOut();
          navigate("/");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  if (checking) return null; // opcional: puedes mostrar un spinner

  return allowed ? children : null;
}
