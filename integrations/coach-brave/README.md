# Puente privado CDMPLab → Coach CDMP (Brave)

Prueba inicial. La extensión solo actúa en `https://coach.cdmpizarrales.es/` y no
lee contraseñas ni envía los datos del entrenamiento a otro servidor. Pide al
responsable de Coach autorización para instalarla si el club gestiona los
navegadores.

## Instalar

1. Abre `brave://extensions`, activa **Modo desarrollador**.
2. Pulsa **Cargar descomprimida** y selecciona esta carpeta `integrations/coach-brave`.
3. Recarga Coach. En una tarea de prueba elige **Imagen → Dibujo**: junto al
   selector PNG debe aparecer **Crear en CDMPLab**.
4. Pulsa ese botón. En CDMPLab crea o abre un ejercicio, dibuja y usa en el menú
   **Exportar → Guardar y enviar a Coach**. Si no hay título, CDMPLab pedirá uno.
5. Vuelve a Coach: debe aparecer el nombre del PNG junto al selector. Pulsa
   **Aplicar** para ver la miniatura y **Guardar** para confirmar el entrenamiento.

No uses primero un entrenamiento importante. Cierra la tarea de prueba sin
guardar si el nombre no aparece donde esperabas. El botón no pulsa **Aplicar**
ni **Guardar** por ti y no modifica la información de carga de la tarea.

La integración necesita que CDMPLab esté publicado con soporte para
`Guardar y enviar a Coach`. Al ser privada, Brave no la actualiza sola: después
de cambiar estos ficheros, pulsa **Actualizar** en `brave://extensions`.

Si Coach sustituye el selector después de abrir CDMPLab, la transferencia se
rechaza para impedir que el PNG termine en otra tarea. Usa la descarga normal
de PNG como alternativa.

Si decides no enviar ese dibujo, vuelve a Coach y pulsa **Cancelar conexión**
junto al selector. Después puedes iniciar otra tarea.
