# Novalis Implant

App para iPhone (web app instalable) para gestionar pedidos de implantes **ETK** (Naturactis e i bone E) en la clínica.

## Funciones

- **Implantes**: elige modelo, paciente, diámetro, longitud y cantidad, y añádelo al pedido.
- **Multiunit**: solicitud de pilares cónicos Tetra (rectos, 17° y 30°) por altura gingival, con su referencia.
- **Pedido**: lista agrupada por paciente y mensaje de texto listo para copiar o enviar al comercial por WhatsApp/SMS. Historial de pedidos; al recibir uno se suma al stock.
- **Stock**: existencias de implantes (tabla diámetro × longitud), Multi-Unit y otros aditamentos, con aviso de stock bajo.
- **Ajustes**: perfil, datos del comercial, catálogo de medidas editable y copia de seguridad.

Por defecto los datos se guardan únicamente en el dispositivo (`localStorage`). Con Firebase configurado (ver más abajo), el pedido, el stock y el historial se comparten entre todos los dispositivos, con inicio de sesión. La app funciona sin conexión en ambos casos.

## Instalar en el iPhone

1. Abre **https://novalis-implant.web.app** en **Safari** en el iPhone.
2. Compartir → **Añadir a pantalla de inicio**.
3. Abre la app desde el icono e inicia sesión.

La app está publicada en Firebase Hosting (`firebase deploy --only hosting`).

## Datos compartidos y usuarios

El pedido, el stock y el historial se guardan en el proyecto de Firebase de la clínica (Firestore, región europea) y se comparten entre todos los dispositivos. Con `window.FIREBASE_CONFIG = null` en `config.js`, la app funciona solo en local.

- **Acceso**: entra quien figura en la lista de usuarios y ha verificado su correo (`firestore.rules`).
- **Administrador**: en Ajustes → *Usuarios con acceso* añade o quita personas. Quitar a alguien le corta el acceso al momento.
- **Alta de un usuario**: el administrador añade su nombre y correo; la persona abre la app, pulsa «Crear cuenta» con ese correo y lo verifica con el enlace que recibe.

## Desarrollo

Sin dependencias ni compilación: HTML, CSS y JavaScript.

```
python3 -m http.server 8000
```

Al publicar cambios, sube la versión de `CACHE` en `sw.js`.
