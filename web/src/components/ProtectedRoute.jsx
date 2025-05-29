import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase/config";

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return null; // O puedes mostrar un spinner
  return isAuthenticated ? children : <Navigate to="/" />;
};

export default ProtectedRoute;
