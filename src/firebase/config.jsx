import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD31Qj1ly4ZZg8Xq6OFxjT_FLV1tRZKgko",
  authDomain: "shipping-time-sheet-3cb24.firebaseapp.com",
  projectId: "shipping-time-sheet-3cb24",
  storageBucket: "shipping-time-sheet-3cb24.firebasestorage.app",
  messagingSenderId: "88737265987",
  appId: "1:88737265987:web:755813dc82c4ca8d3517f6",
  measurementId: "G-DRCBZYYSRX"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
