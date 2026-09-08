// ============================================================
// Firebase Storage — used only for TLP report file uploads
// (tlpReports/{sectionId}/{fileName}). Everything else in the
// portal stays in Firestore.
// ============================================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const storage = getStorage(app);

/** Uploads one file for a section's TLP reports. Returns both the file's
 *  signed-in-only download URL (used immediately) and its Storage path
 *  (so the organizeTlpReportToDrive Cloud Function can read the raw file
 *  and copy it into the shared Drive folder, organized by programme and
 *  semester). Filenames are timestamp-prefixed so two faculty uploading
 *  files with the same name never collide. */
export async function uploadTlpReportFile(sectionId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = `tlpReports/${sectionId}/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(fileRef);
  return { url, storagePath: path };
}
