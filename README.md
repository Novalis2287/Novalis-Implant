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

## Datos compartidos con inicio de sesión (Firebase)

Sin configurar, cada iPhone guarda sus propios datos. Para compartirlos:

1. En [console.firebase.google.com](https://console.firebase.google.com) crea un proyecto (plan gratuito Spark).
2. **Authentication** → Método de acceso → activa **Correo electrónico/contraseña**. En *Usuarios*, crea una cuenta para cada persona.
3. **Firestore Database** → Crear base de datos (modo producción, ubicación europea, p. ej. `eur3`).
4. En Firestore → **Reglas**, pega el contenido de `firestore.rules` sustituyendo los correos de ejemplo por los de las cuentas creadas, y publica.
5. Configuración del proyecto → *Tus apps* → añade una **app web** y copia su configuración en `config.js` (`window.FIREBASE_CONFIG = { … }`).
6. Authentication → Configuración → *Dominios autorizados*: añade el dominio de GitHub Pages (`usuario.github.io`).

La primera persona que inicie sesión sube los datos que ya tuviera en su dispositivo; a partir de ahí manda la nube. Para dar acceso a alguien más: créale la cuenta, añade su correo a las reglas y su nombre a `USERS` en `app.js`.

## Desarrollo

Sin dependencias ni compilación: HTML, CSS y JavaScript.

```
python3 -m http.server 8000
```

Al publicar cambios, sube la versión de `CACHE` en `sw.js`.
