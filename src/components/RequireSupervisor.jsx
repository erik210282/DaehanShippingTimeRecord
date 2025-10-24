// src/components/RequireSupervisor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabase/client";


export default function RequireSupervisor({ children }) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;

        if (!user) {
          if (!mounted) return;
          setAllowed(false);
          setChecking(false);
          navigate("/"); // login
          return;
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          console.error("❌ Error verificando rol:", error);
          if (mounted) {
            setAllowed(false);
            setChecking(false);
          }
          return;
        }

        const isSupervisor = profile?.role === "supervisor" && profile?.is_active === true;

        if (mounted) {
          setAllowed(!!isSupervisor);
          setChecking(false);
          if (!isSupervisor) {
            // Operador o inactivo → forzar logout y mandar a login
            await supabase.auth.signOut();
            navigate("/");
          }
        }
      } catch (e) {
        console.error("❌ Guard error:", e);
        if (mounted) {
          setAllowed(false);
          setChecking(false);
          navigate("/");
        }
      }
    })();

    return () => { mounted = false; };
  }, [navigate]);

  if (checking) {
    return (
      <div style={{height:'100vh', display:'flex', alignItems:'center', justifyContent:'center'}}>
        Cargando…
      </div>
    );
  }

  return allowed ? children : null;
}
