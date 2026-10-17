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
      const [person,membership,admin] = await Promise.all([
        supabase.from("operadores").select("activo").eq("uid",user.id).maybeSingle(),
        supabase.from("global_department_memberships").select("role").eq("user_id",user.id).eq("department","shipping").eq("active",true),
        supabase.from("global_system_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
      ]);
      if (!mounted) return;
      const profile=person.data,error=person.error||membership.error||admin.error;
      // Page-level permissions are enforced separately by SectionPermission.
      const allowed = !error && profile?.activo === true &&
        (!!admin.data || membership.data?.some(m=>["operador","lider","supervisor"].includes(m.role)));
      setIsAuthenticated(allowed);
      if (!profile?.activo && !error) await supabase.auth.signOut({ scope: "local" });
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

  return isAuthenticated ? children : <Navigate to="/inicio" replace />;
};

export default ProtectedRoute;
