import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../supabase/client";

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = loading

  useEffect(() => {
    let mounted = true;
    const verifySession = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError || !user) {
        setIsAuthenticated(false);
        return;
      }
      const { data: profile, error } = await supabase.from("operadores")
        .select("activo, role").eq("uid", user.id).maybeSingle();
      if (!mounted) return;
      const allowed = !error && profile?.activo === true && profile.role === "supervisor";
      setIsAuthenticated(allowed);
      if (!allowed && !error) await supabase.auth.signOut({ scope: "local" });
    };
    verifySession();
    const onFocus = () => { if (document.visibilityState === "visible") verifySession(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    // Suscribirse a cambios
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) setIsAuthenticated(false);
      else setTimeout(verifySession, 0);
    });

    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      listener?.subscription?.unsubscribe();
    };
  }, []);

  if (isAuthenticated === null) return null; // O un spinner

  return isAuthenticated ? children : <Navigate to="/" replace />;
};

export default ProtectedRoute;
