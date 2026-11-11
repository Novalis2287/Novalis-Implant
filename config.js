/* Configuración de Firebase (datos compartidos entre dispositivos).

   Con null, la app guarda los datos solo en este dispositivo.
   Para compartirlos, pega aquí la configuración de tu proyecto de Firebase
   (Consola de Firebase → Configuración del proyecto → Tus apps → App web):

   window.FIREBASE_CONFIG = {
     apiKey: '…',
     authDomain: '….firebaseapp.com',
     projectId: '…',
     appId: '…',
   };

   Estos valores no son secretos: el acceso lo controlan las reglas de firestore.rules. */
window.FIREBASE_CONFIG = null;
