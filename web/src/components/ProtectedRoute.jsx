import React from "react";
import { Navigate } from "react-router-dom";
import { auth } from "../firebase/config";

export default function ProtectedRoute({ children }) {
  const user = auth.currentUser || JSON.parse(localStorage.getItem("usuario"));
  return user ? children : <Navigate to="/" />;
}
