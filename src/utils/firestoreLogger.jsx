// 📄 src/utils/firestoreLogger.js

import {
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  onSnapshot,
  collection,
  doc
} from "firebase/firestore";

import { logLectura } from "../utils/logLecturaWeb";

// 🔍 getDocs wrapper
export const trackedGetDocs = async (ref, meta = {}) => {
  const result = await getDocs(ref);
  const cantidad = result.docs.length;
  await logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "getDocs", cantidad, "lectura");
  return result;
};

// 🔍 getDoc wrapper
export const trackedGetDoc = async (ref, meta = {}) => {
  const result = await getDoc(ref);
  await logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "getDoc", 1, "lectura");
  return result;
};

// ✍️ addDoc wrapper
export const trackedAddDoc = async (ref, data, meta = {}) => {
  const result = await addDoc(ref, data);
  await logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "addDoc", 1, "escritura");
  return result;
};

// ✍️ setDoc wrapper
export const trackedSetDoc = async (ref, data, meta = {}) => {
  await setDoc(ref, data);
  await logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "setDoc", 1, "escritura");
};

// ✍️ updateDoc wrapper
export const trackedUpdateDoc = async (ref, data, meta = {}) => {
  await updateDoc(ref, data);
  await logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "updateDoc", 1, "escritura");
};

// ✂️ deleteDoc wrapper
export const trackedDeleteDoc = async (ref, meta = {}) => {
  await deleteDoc(ref);
  await logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "deleteDoc", 1, "escritura");
};

// 🔁 onSnapshot wrapper (opcional, solo si quieres rastrear cada vez que se activa)
export const trackedOnSnapshot = (ref, callback, meta = {}) => {
  return onSnapshot(ref, (snapshot) => {
    const cantidad = snapshot.docs ? snapshot.docs.length : 1;
    logLectura(meta.pagina || "pagina_desconocida", meta.seccion || "onSnapshot", cantidad, "lectura");
    callback(snapshot);
  });
};
