# Puente privado CDMPLab → Coach CDMP (Chrome y Brave)

Prueba inicial. La extensión solo actúa en `https://coach.cdmpizarrales.es/` y no
lee contraseñas ni envía los datos del entrenamiento a otro servidor. Pide al
responsable de Coach autorización para instalarla si el club gestiona los
navegadores.

La misma extensión sirve para **Chrome y Brave**. No hace falta mantener dos
versiones.

## Instalar

1. Abre `brave://extensions` o `chrome://extensions`, activa **Modo desarrollador**.
2. Pulsa **Cargar descomprimida** y selecciona esta carpeta `integrations/coach-brave`.
3. Recarga Coach. En una tarea de prueba elige **Imagen → Dibujo**: junto al
   selector PNG debe aparecer **Crear en CDMPLab**.
4. Pulsa ese botón. CDMPLab abre **Biblioteca → Nuevo ejercicio**. Revisa los
   campos precargados, completa título y carpeta, y pulsa **Crear y dibujar**.
5. En la pizarra pulsa **Enviar a Coach → Guardar y enviar imagen a Coach**.
6. Vuelve a Coach: debe aparecer el nombre del PNG junto al selector. Pulsa
   **Aplicar** para ver la miniatura y **Guardar** para confirmar el entrenamiento.

No uses primero un entrenamiento importante. Cierra la tarea de prueba sin
guardar si el nombre no aparece donde esperabas. El botón no pulsa **Aplicar**
ni **Guardar** por ti y no modifica la información de carga de la tarea.

La integración necesita que CDMPLab esté publicado con soporte para
`Guardar y enviar imagen a Coach`. Al ser privada, Chrome y Brave no la
actualizan solos: después de cambiar estos ficheros, pulsa **Actualizar** en la
página de extensiones.

Para compartirla con otros técnicos, copia esta carpeta completa. Cada persona
debe cargarla descomprimida en su propio Chrome o Brave. La extensión solo se
ejecuta en Coach y no necesita credenciales extra.

Si Coach no identifica inequívocamente un dato, se deja vacío para revisión.
No se deduce la duración del ejercicio a partir del volumen de la sesión ni de
«Tiempo/rep»; tampoco se modifica su configuración de carga en Coach.

Si Coach sustituye el selector después de abrir CDMPLab, la transferencia se
rechaza para impedir que el PNG termine en otra tarea. Usa la descarga normal
de PNG como alternativa.

Si decides no enviar ese dibujo, vuelve a Coach y pulsa **Cancelar conexión**
junto al selector. Después puedes iniciar otra tarea.
