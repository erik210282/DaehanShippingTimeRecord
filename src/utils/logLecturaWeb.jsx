import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase/config"; // Ajusta si usas otra ruta

const generarAnonId = () => {
  return "anon_" + Math.random().toString(36).substring(2, 10);
};

export const logLectura = async (pagina, seccion = "", cantidad = 1, tipo = "lectura") => {
  try {
    const user = auth.currentUser;
    let email = user?.email || "";

    if (!email && typeof window !== "undefined" && typeof localStorage !== "undefined") {
      let anonId = localStorage.getItem("anonId");
      if (!anonId) {
        anonId = generarAnonId();
        localStorage.setItem("anonId", anonId);
      }
      email = "anonimo_web_" + anonId;
    }

    await addDoc(collection(db, "lectura_logs"), {
      pagina: pagina || "pagina_desconocida",
      seccion,
      cantidad,
      tipo,
      email,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.warn("❗ Error al registrar lectura:", error.message);
  }
};
