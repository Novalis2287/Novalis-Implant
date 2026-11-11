# Novalis Implant

App para iPhone (web app instalable) para gestionar pedidos de implantes **ETK** (Naturactis e i bone E) en la clínica.

## Funciones

- **Implantes**: elige modelo, paciente, diámetro, longitud y cantidad, y añádelo al pedido.
- **Multiunit**: solicitud de pilares cónicos Tetra (rectos, 17° y 30°) por altura gingival, con su referencia.
- **Pedido**: lista agrupada por paciente y mensaje de texto listo para copiar o enviar al comercial por WhatsApp/SMS. Historial de pedidos; al recibir uno se suma al stock.
- **Stock**: existencias de implantes (tabla diámetro × longitud), Multi-Unit y otros aditamentos, con aviso de stock bajo.
- **Ajustes**: perfil, datos del comercial, catálogo de medidas editable y copia de seguridad.

Los datos se guardan únicamente en el dispositivo (`localStorage`) y la app funciona sin conexión.

## Instalar en el iPhone

1. Publica el repositorio con GitHub Pages (Settings → Pages → rama y carpeta `/`).
2. Abre la URL en **Safari** en el iPhone.
3. Compartir → **Añadir a pantalla de inicio**.

## Desarrollo

Sin dependencias ni compilación: HTML, CSS y JavaScript.

```
python3 -m http.server 8000
```

Al publicar cambios, sube la versión de `CACHE` en `sw.js`.
