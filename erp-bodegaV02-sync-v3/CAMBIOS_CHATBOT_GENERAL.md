# Chatbot general - ERP Bodega V02

Esta entrega amplía el chatbot del ERP para que no quede limitado a stock, faltantes y programación.

## Qué cambió

- Las preguntas del ERP siguen usando el contexto operativo actual como fuente de verdad.
- Las consultas puntuales por código de insumo continúan siendo determinísticas y no inventan cantidades.
- Las preguntas que no tienen relación con el ERP pasan a la API de OpenAI como consultas generales.
- Se habilitó búsqueda web automática para consultas que necesiten información reciente.
- Se envían hasta 12 mensajes anteriores para mantener el hilo de una conversación.
- El límite de respuesta aumentó para permitir explicaciones más completas.
- Si `OPENAI_MODEL` contiene un nombre no disponible, se prueban `gpt-5.2`, `gpt-5.1` y `gpt-5` como respaldo.
- Si falta `OPENAI_API_KEY`, el sistema indica claramente que la IA general no está conectada en vez de fingir que la pregunta está fuera de alcance.

## Cloudflare

Para preguntas generales es necesario configurar el secreto `OPENAI_API_KEY` en el Worker. `OPENAI_MODEL` es opcional; se recomienda `gpt-5.2` o directamente dejarlo sin definir para usar el modelo de respaldo preparado en el código.
