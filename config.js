/* Configuración de Firebase (datos compartidos entre dispositivos).

   Con `window.FIREBASE_CONFIG = null` la app guarda los datos solo en este dispositivo.
   La configuración sale de la Consola de Firebase → Configuración del proyecto → Tus apps → App web:

   window.FIREBASE_CONFIG = {
     apiKey: '…',
     authDomain: '….firebaseapp.com',
     projectId: '…',
     appId: '…',
   };

   Estos valores no son secretos: el acceso lo controlan las reglas de firestore.rules. */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDxLLFI5kgDCU0zOjOyFmgADq9Ckxxk39A',
  authDomain: 'novalis-implant.firebaseapp.com',
  projectId: 'novalis-implant',
  appId: '1:9532460756:web:0e065e57448f8fbb947541',
};
