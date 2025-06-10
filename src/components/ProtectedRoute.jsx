import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import supabase from "../supabase/client";

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = loading

  useEffect(() => {
    // Obtener sesión actual
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session?.user);
    });

    // Suscribirse a cambios
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session?.user);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (isAuthenticated === null) return null; // O un spinner

  return isAuthenticated ? children : <Navigate to="/" replace />;
};

export default ProtectedRoute;
