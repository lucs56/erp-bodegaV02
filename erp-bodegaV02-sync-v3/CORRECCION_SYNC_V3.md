# Corrección de sincronización v3

Esta versión elimina la dependencia de tareas que continúan después de responder al navegador.

## Flujo actual

1. Todos los dispositivos consultan `/api/program` cada 30 segundos.
2. D1 conserva la última programación válida compartida.
3. Si la copia está vencida, un lease en D1 elige un único request líder.
4. El request líder espera la respuesta de Google Sheets y guarda la lectura en D1 antes de finalizar.
5. Los demás dispositivos no consultan Google: reciben D1 y, mientras el líder trabaja, releen únicamente D1 cada 2 segundos hasta detectar la nueva versión.
6. El lease contiene un `owner`, por lo que un request viejo no puede liberar el bloqueo de otro Worker.
7. Si Google falla, la interfaz sigue mostrando la última lectura válida y expone el error en el aviso de sincronización.

## Motivo de la corrección

La versión anterior iniciaba la lectura de Google después de responder al navegador. En este deployment esa tarea podía finalizar antes de persistir el resultado. Ahora la lectura que modifica D1 siempre queda asociada a un request vivo.

## Prueba recomendada después de publicar

- Abrir el ERP en dos navegadores o dispositivos.
- Pulsar `Actualizar ahora` en uno.
- Modificar una cantidad visible del Google Sheet.
- Esperar el ciclo automático o pulsar `Actualizar ahora`.
- Confirmar que ambos dispositivos muestran el mismo `Última lectura` y la misma programación.
