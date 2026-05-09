/**
 * Purpose:
 * - Initialize and export Firebase app + Realtime Database singleton.
 *
 * Responsibilities:
 * - Hold project connection metadata.
 * - Expose initialized `db` object for all network modules.
 *
 * Key concepts:
 * - Must remain a singleton module to avoid duplicate app initialization.
 */
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database"; // Thêm dòng này để dùng Realtime Database

const firebaseConfig = {
  apiKey: "AIzaSyAe0BRmVMTYz-bPbTKxnTRz4_v2odDCn1g",
  authDomain: "smart-logistics-uet.firebaseapp.com",
  projectId: "smart-logistics-uet",
  storageBucket: "smart-logistics-uet.firebasestorage.app",
  messagingSenderId: "250876133263",
  appId: "1:250876133263:web:fab2f0305b91fc6e1395fa",
  measurementId: "G-Z2RH619H0B",
  // LƯU Ý: Thêm databaseURL nếu Firebase không tự nhận diện
databaseURL: "https://smart-logistics-uet-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Khởi tạo Firebase (singleton for this client bundle).
const app = initializeApp(firebaseConfig);

// Khởi tạo Realtime Database và export để các file khác (services) sử dụng
export const db = getDatabase(app);
export default app;