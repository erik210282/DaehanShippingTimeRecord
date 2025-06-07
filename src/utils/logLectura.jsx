import { addDoc, getDoc, getDocs, updateDoc, deleteDoc, setDoc, onSnapshot, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../web/src/firebase/config"; // Ajusta si usas otra ruta para config
import { getAuth } from "firebase/auth";

// Solo disponible en móvil
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const generarAnonId = () => {
  return "anon_" + Math.random().toString(36).substring(2, 10);
};

export const logLectura = async (pagina, seccion = "", cantidad = 1, tipo = "lectura") => {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    let email = user?.email || "";

    if (!email) {
      let anonId = null;

      if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
        anonId = localStorage.getItem("anonId");
        if (!anonId) {
          anonId = generarAnonId();
          localStorage.setItem("anonId", anonId);
        }
        email = "anonimo_web_" + anonId;
      } else {
        anonId = await AsyncStorage.getItem("anonId");
        if (!anonId) {
          anonId = generarAnonId();
          await AsyncStorage.setItem("anonId", anonId);
        }
        const tipoPlataforma = Platform.OS === "ios" ? "ios" : "android";
        email = `anonimo_${tipoPlataforma}_${anonId}`;
      }
    }

    await addDoc(collection(db, "lectura_logs"), {
      pagina,
      seccion,
      cantidad,
      tipo, // "lectura" o "escritura"
      email,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.warn("❗ Error al registrar lectura:", error.message);
  }
};
